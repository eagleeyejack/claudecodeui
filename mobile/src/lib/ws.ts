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

export type ServerEvent = ChatMessage & { type?: string; seq?: number; sessionId?: string };

type SubscribeEntry = { sessionId: string; lastSeq: number };

export class ChatSocket {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, number>();
  private listeners = new Set<(event: ServerEvent) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
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
    };
    socket.onmessage = (raw) => {
      try {
        const event = JSON.parse(String(raw.data)) as ServerEvent;
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

  sendMessage(sessionId: string, content: string): void {
    this.sendRaw({ type: 'chat.send', sessionId, content, options: {} });
  }

  abort(sessionId: string): void {
    this.sendRaw({ type: 'chat.abort', sessionId });
  }

  private sendRaw(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
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
    this.subscriptions.clear();
    this.socket?.close();
    this.socket = null;
  }
}

export const chatSocket = new ChatSocket();
