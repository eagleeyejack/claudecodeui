/**
 * Unit tests for the WebSocket layer (`src/lib/ws.ts`).
 *
 * Mocks `global.WebSocket` (and stubs `global.fetch`, unused by this module)
 * and uses jest fake timers for reconnect/backoff assertions.
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

  lastSentJson(): any {
    return JSON.parse(this.sent[this.sent.length - 1]);
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

describe('connect', () => {
  it('builds a ws:// URL with the token from an http baseUrl', () => {
    const socket = new ChatSocket();
    socket.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toBe('ws://example.com/ws?token=secret');
  });

  it('builds a wss:// URL from an https baseUrl and encodes the token', () => {
    setAuth({ baseUrl: 'https://host:1234', token: 'a b&c', username: 'u' });

    const socket = new ChatSocket();
    socket.connect();

    expect(lastSocket().url).toBe(
      `wss://host:1234/ws?token=${encodeURIComponent('a b&c')}`,
    );
  });

  it('does nothing without auth and does not double-connect', () => {
    setAuth(null);
    const socket = new ChatSocket();
    socket.connect();
    expect(MockWebSocket.instances).toHaveLength(0);

    setAuth({ baseUrl: 'http://example.com', token: 't', username: 'u' });
    socket.connect();
    socket.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('outgoing frames', () => {
  it('subscribe sends {type: chat.subscribe, sessions:[{sessionId,lastSeq}]}', () => {
    const socket = new ChatSocket();
    socket.connect();
    lastSocket().onopen?.({});

    socket.subscribe('sess-1');

    expect(lastSocket().lastSentJson()).toEqual({
      type: 'chat.subscribe',
      sessions: [{ sessionId: 'sess-1', lastSeq: 0 }],
    });
  });

  it('sendMessage and abort frame shapes', () => {
    const socket = new ChatSocket();
    socket.connect();
    lastSocket().onopen?.({});

    socket.sendMessage('sess-1', 'hello');
    expect(lastSocket().lastSentJson()).toEqual({
      type: 'chat.send',
      sessionId: 'sess-1',
      content: 'hello',
      options: {},
    });

    socket.abort('sess-1');
    expect(lastSocket().lastSentJson()).toEqual({
      type: 'chat.abort',
      sessionId: 'sess-1',
    });
  });
});

describe('lastSeq tracking across reconnects', () => {
  it('resubscribes with the high-water mark seen on incoming events', () => {
    const socket = new ChatSocket();
    socket.connect();
    const first = lastSocket();
    first.onopen?.({});
    socket.subscribe('s1');

    // Incoming events advance the tracked lastSeq (max wins).
    first.onmessage?.({
      data: JSON.stringify({ sessionId: 's1', seq: 5, content: 'hi' }),
    });
    first.onmessage?.({
      data: JSON.stringify({ sessionId: 's1', seq: 3, content: 'stale' }),
    });

    // Drop the connection; the scheduled reconnect fires after 1s.
    first.onclose?.({});
    jest.advanceTimersByTime(1000);

    expect(MockWebSocket.instances).toHaveLength(2);
    const second = lastSocket();
    second.onopen?.({});

    expect(second.lastSentJson()).toEqual({
      type: 'chat.subscribe',
      sessions: [{ sessionId: 's1', lastSeq: 5 }],
    });
  });
});

describe('reconnect backoff', () => {
  it('caps the delay at 30s', () => {
    const socket = new ChatSocket();
    socket.connect();

    const spy = jest.spyOn(global, 'setTimeout');
    const delays: number[] = [];

    // Fail repeatedly without ever firing onopen so `attempts` keeps growing.
    // Expected delays: 1000, 2000, 4000, 8000, 16000, 30000, 30000, ...
    for (let i = 0; i < 8; i++) {
      lastSocket().onclose?.({});
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
      const delay = lastCall[1] as unknown as number;
      delays.push(delay);
      jest.advanceTimersByTime(delay);
    }

    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(delays[5]).toBe(30000);
    expect(delays[6]).toBe(30000);
    expect(delays[7]).toBe(30000);
    expect(Math.max(...delays)).toBe(30000);

    socket.close();
  });

  it('resets the backoff after a successful open', () => {
    const socket = new ChatSocket();
    socket.connect();
    const spy = jest.spyOn(global, 'setTimeout');

    lastSocket().onclose?.({});
    jest.advanceTimersByTime(1000);
    // Successful reconnect resets attempts to 0.
    lastSocket().onopen?.({});

    lastSocket().onclose?.({});
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect(lastCall[1]).toBe(1000);

    socket.close();
  });
});

describe('close', () => {
  it('clears subscriptions so a later connect resubscribes to nothing', () => {
    const socket = new ChatSocket();
    socket.connect();
    lastSocket().onopen?.({});
    socket.subscribe('s1');
    expect((socket as any).subscriptions.size).toBe(1);

    socket.close();
    expect((socket as any).subscriptions.size).toBe(0);

    // Reconnect after close: resubscribe is a no-op with zero subscriptions.
    socket.connect();
    const fresh = lastSocket();
    fresh.onopen?.({});
    expect(fresh.sent).toHaveLength(0);

    socket.close();
  });

  it('stops reconnects (pending timer and onclose after close)', () => {
    const socket = new ChatSocket();
    socket.connect();
    const first = lastSocket();
    const countAfterConnect = MockWebSocket.instances.length;

    // Schedule a reconnect, then close before the timer fires.
    first.onclose?.({});
    socket.close();
    jest.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(countAfterConnect);

    // An onclose arriving after close() must not schedule a reconnect either.
    first.onclose?.({});
    jest.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(countAfterConnect);
  });
});

describe('malformed frames', () => {
  it('ignores frames that are not valid JSON', () => {
    const socket = new ChatSocket();
    socket.connect();
    const listener = jest.fn();
    socket.onEvent(listener);

    expect(() =>
      lastSocket().onmessage?.({ data: 'not-json{{{' }),
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();

    // A valid frame afterwards is still delivered.
    lastSocket().onmessage?.({
      data: JSON.stringify({ sessionId: 's1', seq: 1 }),
    });
    expect(listener).toHaveBeenCalledTimes(1);

    socket.close();
  });
});
