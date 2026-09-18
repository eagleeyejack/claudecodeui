/**
 * Unit tests for the Phase 3b socket runtime (`src/lib/ws.ts`): offline
 * outbox hold + `chat.permission-response` answers.
 *
 * Mocks `global.WebSocket` and uses jest fake timers for reconnects,
 * following `ws.test.ts`.
 */
import { setAuth } from '@/lib/api';
import { ChatSocket } from '@/lib/ws';

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  onopen: ((ev?: any) => void) | null = null;
  onmessage: ((ev?: any) => void) | null = null;
  onclose: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  close = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });
  send = jest.fn((data: string) => {
    this.sent.push(data);
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  sentJson(): any[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

const lastSocket = () =>
  MockWebSocket.instances[MockWebSocket.instances.length - 1];

beforeEach(() => {
  (global as any).fetch = jest.fn();
  (global as any).WebSocket = MockWebSocket as any;
  MockWebSocket.instances = [];
  setAuth({ baseUrl: 'http://example.com', token: 'secret', username: 'u' });
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function connectWithSubscription(sessionId = 's1'): ChatSocket {
  const socket = new ChatSocket();
  socket.connect();
  lastSocket().onopen?.({});
  socket.subscribe(sessionId);
  return socket;
}

/** Drops the transport without firing onclose (stale socket, airplane mode). */
function dropTransport() {
  lastSocket().readyState = MockWebSocket.CLOSED;
}

/** Fires onclose and runs the scheduled reconnect, returning the fresh socket. */
function reconnect(): MockWebSocket {
  lastSocket().onclose?.({});
  jest.advanceTimersByTime(1000);
  const fresh = lastSocket();
  fresh.onopen?.({});
  return fresh;
}

describe('sendMessage with options', () => {
  it('carries attachments + model + effort in the chat.send frame', () => {
    const socket = connectWithSubscription();
    const socketBefore = lastSocket();
    const countBefore = socketBefore.sent.length;

    const result = socket.sendMessage('s1', 'look at this', {
      model: 'sonnet',
      effort: 'high',
      attachments: [{ path: '/assets/a.png', name: 'a.png', mimeType: 'image/png' }],
    });

    expect(result).toBe('sent');
    expect(socketBefore.sentJson()[countBefore]).toEqual({
      type: 'chat.send',
      sessionId: 's1',
      content: 'look at this',
      options: {
        model: 'sonnet',
        effort: 'high',
        attachments: [{ path: '/assets/a.png', name: 'a.png', mimeType: 'image/png' }],
      },
    });
    expect(socket.getOutbox()).toEqual([]);

    socket.close();
  });
});

describe('offline outbox hold', () => {
  it('queues sends while the socket is down and flushes FIFO after resubscribe', () => {
    const socket = connectWithSubscription();
    dropTransport();

    expect(socket.sendMessage('s1', 'first')).toBe('queued');
    expect(socket.sendMessage('s1', 'second', { model: 'opus' })).toBe('queued');
    expect(lastSocket().sent).toHaveLength(1); // only the subscribe frame
    expect(socket.getOutbox()).toHaveLength(2);

    const fresh = reconnect();

    const frames = fresh.sentJson();
    // Resubscribe first so the server replays missed events, then the held turns.
    expect(frames[0]).toEqual({
      type: 'chat.subscribe',
      sessions: [{ sessionId: 's1', lastSeq: 0 }],
    });
    expect(frames[1]).toEqual({
      type: 'chat.send',
      sessionId: 's1',
      content: 'first',
      options: {},
    });
    expect(frames[2]).toEqual({
      type: 'chat.send',
      sessionId: 's1',
      content: 'second',
      options: { model: 'opus' },
    });
    expect(socket.getOutbox()).toEqual([]);

    socket.close();
  });

  it('notifies onOutboxFlush listeners with the flushed entries', () => {
    const socket = connectWithSubscription();
    dropTransport();
    socket.sendMessage('s1', 'held');

    const listener = jest.fn();
    socket.onOutboxFlush(listener);
    reconnect();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([
      { type: 'chat.send', sessionId: 's1', content: 'held', options: {} },
    ]);

    socket.close();
  });

  it('does not fire onOutboxFlush when there is nothing held', () => {
    const socket = connectWithSubscription();
    const listener = jest.fn();
    socket.onOutboxFlush(listener);

    lastSocket().onclose?.({});
    jest.advanceTimersByTime(1000);
    lastSocket().onopen?.({});

    expect(listener).not.toHaveBeenCalled();

    socket.close();
  });

  it('close() drops held frames so they never leak into the next session', () => {
    const socket = connectWithSubscription();
    dropTransport();
    socket.sendMessage('s1', 'held');
    expect(socket.getOutbox()).toHaveLength(1);

    socket.close();
    expect(socket.getOutbox()).toEqual([]);

    // A later connect flushes nothing.
    socket.connect();
    const fresh = lastSocket();
    fresh.onopen?.({});
    expect(fresh.sent).toHaveLength(0);

    socket.close();
  });
});

describe('respondToPermission', () => {
  it('sends the chat.permission-response frame when open', () => {
    const socket = connectWithSubscription();
    const transport = lastSocket();
    const countBefore = transport.sent.length;

    const result = socket.respondToPermission('req-1', { allow: true });

    expect(result).toBe('sent');
    expect(transport.sentJson()[countBefore]).toEqual({
      type: 'chat.permission-response',
      requestId: 'req-1',
      allow: true,
    });

    socket.close();
  });

  it('carries the allow-and-remember entry through', () => {
    const socket = connectWithSubscription();
    const transport = lastSocket();
    const countBefore = transport.sent.length;

    socket.respondToPermission('req-2', { allow: true, rememberEntry: 'Bash(npm test:*)' });

    expect(transport.sentJson()[countBefore]).toEqual({
      type: 'chat.permission-response',
      requestId: 'req-2',
      allow: true,
      rememberEntry: 'Bash(npm test:*)',
    });

    socket.close();
  });

  it('queues the answer while down so the run never stalls silently', () => {
    const socket = connectWithSubscription();
    dropTransport();

    expect(socket.respondToPermission('req-9', { allow: false, message: 'nope' })).toBe('queued');
    expect(socket.getOutbox()).toHaveLength(1);

    const fresh = reconnect();
    const frames = fresh.sentJson();
    expect(frames[frames.length - 1]).toEqual({
      type: 'chat.permission-response',
      requestId: 'req-9',
      allow: false,
      message: 'nope',
    });
    expect(socket.getOutbox()).toEqual([]);

    socket.close();
  });
});
