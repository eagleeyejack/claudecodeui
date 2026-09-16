/**
 * Typed REST client for the CloudCLI server.
 *
 * Mirrors the small slice of `server/shared/types.ts` the mobile client
 * renders. Auth is a JWT from `POST /api/auth/login` (same as the web app),
 * sent as `Authorization: Bearer` on REST and `?token=` on the WebSocket.
 */

export type LLMProvider = 'claude' | 'codex' | 'cursor' | 'opencode' | 'gemini';

export type SessionSummary = {
  provider?: LLMProvider;
  id: string;
  provider_session_id?: string | null;
  title?: string | null;
  summary?: string | null;
  messageCount?: number;
  lastActivity?: string;
  mtimeMs?: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  sessions?: SessionSummary[];
};

/** Subset of the server's `NormalizedMessage` envelope the mobile UI renders. */
export type ChatMessage = {
  id: string;
  sessionId: string;
  timestamp: string;
  provider?: LLMProvider;
  kind: string;
  seq?: number;
  role?: 'user' | 'assistant';
  content?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  error?: string | null;
};

type StoredAuth = { baseUrl: string; token: string; username: string };

let auth: StoredAuth | null = null;

export const setAuth = (next: StoredAuth | null) => {
  auth = next;
};

export const getAuth = () => auth;

export const normalizeBaseUrl = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Server URL is required');
  if (!/^https?:\/\//.test(trimmed)) throw new Error('Server URL must start with http:// or https://');
  return trimmed;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (!auth) throw new Error('Not signed in');
  const response = await fetch(`${auth.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401) throw new Error('Session expired — sign in again');
  if (!response.ok) throw new Error(`${response.status} ${response.statusText || 'request failed'}`);
  return (await response.json()) as T;
};

export const login = async (baseUrl: string, username: string, password: string) => {
  const normalized = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${normalized}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error('Invalid username or password');
  const body = (await response.json()) as { success?: boolean; token?: string; user?: { username?: string } };
  if (!body.token) throw new Error('Login response missing token');
  const next: StoredAuth = { baseUrl: normalized, token: body.token, username: body.user?.username ?? username };
  setAuth(next);
  return next;
};

export const healthCheck = async (rawBaseUrl: string): Promise<void> => {
  const response = await fetch(`${normalizeBaseUrl(rawBaseUrl)}/health`);
  if (!response.ok) throw new Error(`Server responded ${response.status}`);
};

export const fetchProjects = () =>
  request<ProjectSummary[]>('/api/projects?skipSynchronization=1');

/** History rows are wrapped by `createApiSuccessResponse` server-side. */
export const fetchMessages = (sessionId: string): Promise<{ messages?: ChatMessage[] }> =>
  request(`/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`);
