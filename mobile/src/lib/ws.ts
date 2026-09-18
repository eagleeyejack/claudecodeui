/**
 * WebSocket chat client.
 *
 * Frames mirror the web client (`src/modules/chat/ChatInterface.tsx` and
 * `useChatComposerState.ts`): `chat.subscribe` carries per-session `lastSeq`
 * so the server replays events missed across reconnects, `chat.send` posts a
 * user turn, `chat.abort` stops a run. Auth rides the `?token=` query param
 * because React Native WebSockets cannot set custom headers.
 */
import { getAuth } from '@/lib/api';
import type { ChatMessage } from '@/lib/api';
import type { PendingPermissionRequest } from '@/lib/permissions';

export type ServerEvent = ChatMessage & {
  type?: string;
  seq?: number;
  sessionId?: string;
  /** Authoritative run flag on `chat_subscribed` acks. */
  isProcessing?: boolean;
  /** Approvals awaiting a decision on `chat_subscribed` acks. */
  pendingPermissions?: PendingPermissionRequest[];
  /** Tool-approval fields on `permission_request` frames. */
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  /** Failure code on `protocol_error` frames. */
  code?: string;
  error?: string;
};

/** Attachment descriptor carried in `chat.send` options (server re-validates paths). */
export type ChatAttachmentRef = { path: string; name?: string; mimeType?: string; size?: number };

export type ChatSendOptions = {
  attachments?: ChatAttachmentRef[];
  model?: string;
  effort?: string;
  /** Permission mode the turn runs under; omit for server default. */
  permissionMode?: string;
  /** Named agent (opencode `--agent`) the turn runs under; omit for build. */
  agent?: string;
};

export type PermissionDecision = {
  allow: boolean;
  message?: string;
  rememberEntry?: string | null;
  updatedInput?: unknown;
};

/**
 * Frames held while the socket is down and flushed FIFO on reconnect.
 * `chat.send` holds the user's turn; `chat.permission-response` holds an
 * approval answer so a run never stalls silently across a dropout.
 */
export type OutboxEntry =
  | { type: 'chat.send'; sessionId: string; content: string; options: ChatSendOptions }
  | { type: 'chat.permission-response'; requestId: string; allow: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown };

type SubscribeEntry = { sessionId: string; lastSeq: number };

export class ChatSocket {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, number>();
  private listeners = new Set<(event: ServerEvent) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private outbox: OutboxEntry[] = [];
  private outboxListeners = new Set<(entries: OutboxEntry[]) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUser = false;

  onEvent(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Current socket state for UI that subscribes after `onopen` already fired. */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Fired with the entries flushed after a reconnect (empty flushes stay silent). */
  onOutboxFlush(listener: (entries: OutboxEntry[]) => void): () => void {
    this.outboxListeners.add(listener);
    return () => this.outboxListeners.delete(listener);
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Frames held while offline, oldest first. */
  getOutbox(): OutboxEntry[] {
    return [...this.outbox];
  }

  connect(): void {
    const auth = getAuth();
    if (!auth || this.socket) return;
    this.closedByUser = false;
    const wsBase = auth.baseUrl.replace(/^http/, 'ws');
    const socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(auth.token)}`);

    socket.onopen = () => {
      this.attempts = 0;
      this.statusListeners.forEach((listener) => listener(true));
      this.resubscribe();
      this.flushOutbox();
    };
    socket.onmessage = (raw) => {
      try {
        const event = JSON.parse(String(raw.data)) as ServerEvent;
        // Ignore valid-JSON-but-not-an-event payloads (`123`, `"ok"`, `null`):
        // listeners assume an object with optional `sessionId`/`seq`.
        if (!event || typeof event !== 'object') return;
        if (event.sessionId && typeof event.seq === 'number') {
          this.subscriptions.set(event.sessionId, Math.max(this.subscriptions.get(event.sessionId) ?? 0, event.seq));
        }
        this.listeners.forEach((listener) => listener(event));
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      this.socket = null;
      this.statusListeners.forEach((listener) => listener(false));
      if (!this.closedByUser) this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
    this.socket = socket;
  }

  /** Re-subscribe after reconnect; the server replays events after each `lastSeq`. */
  private resubscribe(): void {
    if (this.subscriptions.size === 0) return;
    this.sendRaw({
      type: 'chat.subscribe',
      sessions: [...this.subscriptions.entries()].map(([sessionId, lastSeq]) => ({ sessionId, lastSeq })),
    });
  }

  subscribe(sessionId: string): void {
    if (!this.subscriptions.has(sessionId)) this.subscriptions.set(sessionId, 0);
    this.sendRaw({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: this.subscriptions.get(sessionId) ?? 0 }] });
  }

  unsubscribe(sessionId: string): void {
    this.subscriptions.delete(sessionId);
  }

  sendMessage(sessionId: string, content: string, options: ChatSendOptions = {}): 'sent' | 'queued' {
    const entry: OutboxEntry = { type: 'chat.send', sessionId, content, options };
    if (this.isOpen()) {
      this.socket?.send(JSON.stringify(entry));
      return 'sent';
    }
    // Offline hold: kept in the outbox and flushed on reconnect instead of
    // the old silent drop.
    this.outbox.push(entry);
    return 'queued';
  }

  /**
   * Answers one tool-approval prompt (`chat.permission-response`). Queued
   * while offline like sends, so a run never stalls for lack of an answer.
   */
  respondToPermission(requestId: string, decision: PermissionDecision): 'sent' | 'queued' {
    const entry: OutboxEntry = { type: 'chat.permission-response', requestId, ...decision };
    if (this.isOpen()) {
      this.socket?.send(JSON.stringify(entry));
      return 'sent';
    }
    this.outbox.push(entry);
    return 'queued';
  }

  abort(sessionId: string): void {
    this.sendRaw({ type: 'chat.abort', sessionId });
  }

  private sendRaw(payload: unknown): void {
    if (this.isOpen()) {
      this.socket?.send(JSON.stringify(payload));
    }
  }

  /** Sends held frames oldest-first after a reconnect. */
  private flushOutbox(): void {
    if (!this.isOpen() || this.outbox.length === 0) return;
    const entries = this.outbox;
    this.outbox = [];
    for (const entry of entries) {
      this.socket?.send(JSON.stringify(entry));
    }
    this.outboxListeners.forEach((listener) => listener(entries));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** this.attempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    // Fresh user-initiated connects start with a fast retry, not a stale cap.
    this.attempts = 0;
    this.subscriptions.clear();
    // A signed-out outbox must never leak into the next account's session.
    this.outbox = [];
    this.socket?.close();
    this.socket = null;
  }
}

export const chatSocket = new ChatSocket();
