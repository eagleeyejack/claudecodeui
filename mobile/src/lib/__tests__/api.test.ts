/**
 * Unit tests for the REST layer (`src/lib/api.ts`).
 *
 * Mocks `global.fetch`; no real network is used.
 */
import {
  fetchMessages,
  fetchProjects,
  getAuth,
  login,
  normalizeBaseUrl,
  projectIdOf,
  projectNameOf,
  sessionIdOf,
  setAuth,
} from '@/lib/api';

const mockFetch = jest.fn();

const jsonResponse = (
  body: unknown,
  init?: { ok?: boolean; status?: number; statusText?: string },
) =>
  ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
  }) as unknown as Response;

beforeEach(() => {
  (global as any).fetch = mockFetch;
  (global as any).WebSocket = (global as any).WebSocket ?? class {};
  mockFetch.mockReset();
  setAuth(null);
  jest.useRealTimers();
});

describe('normalizeBaseUrl', () => {
  it('trims a single trailing slash', () => {
    expect(normalizeBaseUrl('http://example.com/')).toBe('http://example.com');
  });

  it('trims multiple trailing slashes and surrounding whitespace', () => {
    expect(normalizeBaseUrl('  https://example.com///  ')).toBe('https://example.com');
  });

  it('leaves a clean URL untouched', () => {
    expect(normalizeBaseUrl('https://example.com')).toBe('https://example.com');
  });

  it('requires an http(s) scheme', () => {
    expect(() => normalizeBaseUrl('example.com')).toThrow(
      'Server URL must start with http:// or https://',
    );
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(
      'Server URL must start with http:// or https://',
    );
  });

  it('throws on empty input', () => {
    expect(() => normalizeBaseUrl('')).toThrow('Server URL is required');
    expect(() => normalizeBaseUrl('   ')).toThrow('Server URL is required');
  });
});

describe('login', () => {
  it('stores the normalized baseUrl and token on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: true, token: 'tok123', user: { username: 'alice' } }),
    );

    const result = await login('http://host/', 'alice', 'pw');

    expect(result).toEqual({ baseUrl: 'http://host', token: 'tok123', username: 'alice' });
    expect(getAuth()).toEqual({ baseUrl: 'http://host', token: 'tok123', username: 'alice' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://host/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'alice', password: 'pw' }),
      }),
    );
  });

  it('falls back to the supplied username when the body has no user', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, token: 'tok' }));

    const result = await login('http://host', 'bob', 'pw');

    expect(result.username).toBe('bob');
  });

  it('throws "Invalid username or password" on non-ok responses', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: false }, { ok: false, status: 401, statusText: 'Unauthorized' }),
    );

    await expect(login('http://host', 'alice', 'wrong')).rejects.toThrow(
      'Invalid username or password',
    );
    expect(getAuth()).toBeNull();
  });

  it('throws when the response has no token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true }));

    await expect(login('http://host', 'alice', 'pw')).rejects.toThrow(
      'Login response missing token',
    );
    expect(getAuth()).toBeNull();
  });
});

describe('request auth handling (via fetchProjects)', () => {
  it('throws "Session expired" on 401', async () => {
    setAuth({ baseUrl: 'http://host', token: 't', username: 'u' });
    mockFetch.mockResolvedValue(
      jsonResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' }),
    );

    await expect(fetchProjects()).rejects.toThrow('Session expired');
  });

  it('sends the Bearer token', async () => {
    setAuth({ baseUrl: 'http://host', token: 'tok123', username: 'u' });
    mockFetch.mockResolvedValue(jsonResponse([]));

    await fetchProjects();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://host/api/projects?skipSynchronization=1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
  });
});

describe('fetchMessages', () => {
  const msg = {
    id: 'm1',
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00Z',
    kind: 'text',
    content: 'hello',
  };

  beforeEach(() => {
    setAuth({ baseUrl: 'http://host', token: 't', username: 'u' });
  });

  it('unwraps the {success:true, data:{messages:[...]}} envelope', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, data: { messages: [msg] } }));

    const result = await fetchMessages('s1');

    expect(result).toEqual({ messages: [msg] });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://host/api/providers/sessions/s1/messages',
      expect.anything(),
    );
  });

  it('tolerates a bare {messages:[...]} shape', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ messages: [msg] }));

    const result = await fetchMessages('s1');

    expect(result).toEqual({ messages: [msg] });
  });

  it('returns {messages: []} when neither shape is present', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ success: true, data: {} }));

    await expect(fetchMessages('s1')).resolves.toEqual({ messages: [] });

    mockFetch.mockResolvedValue(jsonResponse({}));

    await expect(fetchMessages('s1')).resolves.toEqual({ messages: [] });
  });

  it('URL-encodes the session id', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ messages: [] }));

    await fetchMessages('s/1 with space');

    expect(mockFetch).toHaveBeenCalledWith(
      `http://host/api/providers/sessions/${encodeURIComponent('s/1 with space')}/messages`,
      expect.anything(),
    );
  });
});

describe('accessor helpers', () => {
  it('projectIdOf prefers server shape, then legacy id, then path', () => {
    expect(projectIdOf({ projectId: 'p1', displayName: 'P', path: '/x' } as any)).toBe('p1');
    expect(projectIdOf({ id: 'legacy-id', displayName: 'P', path: '/x' } as any)).toBe(
      'legacy-id',
    );
    expect(projectIdOf({ path: '/only' } as any)).toBe('/only');
  });

  it('projectNameOf prefers server shape, then legacy name, then path', () => {
    expect(projectNameOf({ projectId: 'p1', displayName: 'Server Name', path: '/x' } as any)).toBe(
      'Server Name',
    );
    expect(
      projectNameOf({ projectId: 'p1', name: 'Legacy Name', path: '/x' } as any),
    ).toBe('Legacy Name');
    expect(projectNameOf({ projectId: 'p1', path: '/fallback' } as any)).toBe('/fallback');
  });

  it('sessionIdOf prefers server shape, then legacy sessionId, then empty string', () => {
    expect(sessionIdOf({ id: 's1' } as any)).toBe('s1');
    expect(sessionIdOf({ sessionId: 'legacy-s' } as any)).toBe('legacy-s');
    expect(sessionIdOf({} as any)).toBe('');
  });
});
