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
  /** Server field is `id`; older cached rows may carry `sessionId` instead. */
  id: string;
  sessionId?: string;
  provider_session_id?: string | null;
  title?: string | null;
  summary?: string | null;
  messageCount?: number;
  lastActivity?: string;
  mtimeMs?: number;
};

export type ProjectSummary = {
  /** Server field is `projectId`; older cached rows may carry `id` instead. */
  projectId: string;
  id?: string;
  /** Server field is `displayName`; older cached rows may carry `name` instead. */
  displayName: string;
  name?: string;
  path: string;
  fullPath?: string;
  isStarred?: boolean;
  sessions?: SessionSummary[];
};

/** Project id regardless of which shape the row arrived in. */
export const projectIdOf = (project: ProjectSummary): string =>
  project.projectId ?? project.id ?? project.path;

/** Display name regardless of which shape the row arrived in. */
export const projectNameOf = (project: ProjectSummary): string =>
  project.displayName ?? project.name ?? project.path;

/** Session id regardless of which shape the row arrived in. */
export const sessionIdOf = (session: SessionSummary): string =>
  session.id ?? session.sessionId ?? '';

/** Session row inside a project listing (server shape). */
export type ProjectSessionRow = {
  id: string;
  provider?: LLMProvider;
  summary?: string | null;
  messageCount?: number;
  lastActivity?: string;
};

export type SessionMeta = {
  hasMore: boolean;
  total: number;
};

export type RecentConversation = {
  sessionId: string;
  provider?: LLMProvider;
  projectId?: string;
  projectDisplayName?: string;
  sessionTitle?: string | null;
  lastActivity?: string;
};

export type RunningSession = {
  sessionId: string;
  provider?: LLMProvider;
  startedAt?: string;
  lastSeq?: number;
};

export type ArchivedSession = {
  sessionId: string;
  provider?: LLMProvider;
  projectId?: string;
  projectDisplayName?: string;
  sessionTitle?: string | null;
  lastActivity?: string;
};

export type SessionDetail = {
  sessionId: string;
  provider?: LLMProvider;
  summary?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastActivity?: string;
  isArchived?: boolean;
  project?: { projectId: string; path: string; displayName: string; isStarred?: boolean } | null;
};

export type ProviderCapability = {
  provider: LLMProvider;
  /** Permission modes the provider runs a turn under, in order. */
  permissionModes?: string[];
  supportsImages?: boolean;
  supportsFiles?: boolean;
  supportsAbort?: boolean;
  supportsEffort?: boolean;
  supportsMessageEditing?: boolean;
  supportsSessionForking?: boolean;
  supportsTokenUsage?: boolean;
};

export type ModelOption = {
  value: string;
  label: string;
  description?: string;
  recordId?: number;
  isCustom?: boolean;
  effort?: { default?: string; values: { value: string; description?: string }[] };
};

/** Full model catalog for one provider (`GET /:provider/models`). */
export type ModelsCatalog = {
  OPTIONS: ModelOption[];
  DEFAULT: string;
};

/** Model + effort one session runs with (`GET active-model`). */
export type SessionModelState = {
  provider: LLMProvider;
  sessionId: string | null;
  model: string;
  /** Null when the session has not recorded an effort choice yet. */
  effort: string | null;
  source: string;
};

/** One stored chat attachment returned by `POST /api/assets/images`. */
export type StoredAttachment = {
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

export type TokenUsage = {
  used?: number;
  total?: number;
  inputTokens?: number;
  outputTokens?: number;
  unsupported?: boolean;
  message?: string;
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
  /** Local-only send state for optimistic rows held while offline. */
  delivery?: 'waiting';
  /** Local-only attachments carried on an optimistic user row. */
  attachments?: StoredAttachment[];
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
export const fetchMessages = async (sessionId: string): Promise<{ messages?: ChatMessage[] }> => {
  const body = await request<{ messages?: ChatMessage[]; success?: boolean; data?: { messages?: ChatMessage[] } }>(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  // Unwrap the `{success, data}` envelope; tolerate a bare `{messages}` shape.
  if (Array.isArray(body.messages)) return { messages: body.messages };
  if (body.data && Array.isArray(body.data.messages)) return { messages: body.data.messages };
  return { messages: [] };
};

//----------------- Session management (JAA projects/chat-manage) ------------

type SuccessEnvelope<T> = { success: boolean; data: T };

/** Paginated sessions for one project. */
export const fetchProjectSessions = (
  projectId: string,
  limit = 20,
  offset = 0,
): Promise<{ projectId: string; sessions: ProjectSessionRow[]; sessionMeta: SessionMeta }> =>
  request(
    `/api/projects/${encodeURIComponent(projectId)}/sessions?limit=${limit}&offset=${offset}`,
  );

/** Cross-project recent conversations. */
export const fetchRecentSessions = (
  limit = 40,
  offset = 0,
): Promise<{ conversations: RecentConversation[]; total: number; hasMore: boolean }> =>
  request(`/api/providers/sessions/recent?limit=${limit}&offset=${offset}`);

/** Currently running agent sessions. */
export const fetchRunningSessions = (): Promise<{ sessions: RunningSession[] }> =>
  request('/api/providers/sessions/running');

/** Archived sessions, grouped client-side by project. */
export const fetchArchivedSessions = (): Promise<{ sessions: ArchivedSession[] }> =>
  request('/api/providers/sessions/archived');

/** Full metadata for one session (used by deep links). */
export const fetchSessionDetail = (sessionId: string): Promise<SessionDetail> =>
  request<SuccessEnvelope<SessionDetail>>(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}`,
  ).then((body) => body.data);

/** Starts a new session in a project, then chat over WS with the returned id. */
export const createSession = (
  provider: LLMProvider,
  projectPath: string,
  initialMessage?: string,
): Promise<{ sessionId: string; provider: LLMProvider; projectPath: string; sessionName?: string }> =>
  request<SuccessEnvelope<{ sessionId: string; provider: LLMProvider; projectPath: string; sessionName?: string }>>(
    '/api/providers/sessions',
    {
      method: 'POST',
      body: JSON.stringify({ provider, projectPath, ...(initialMessage ? { initialMessage } : {}) }),
    },
  ).then((body) => body.data);

/** Renames a session (1–500 chars). */
export const renameSession = (sessionId: string, summary: string): Promise<void> =>
  request(`/api/providers/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    body: JSON.stringify({ summary }),
  }).then(() => undefined);

/** Archives (default) or hard-deletes a session. */
export const deleteSession = (
  sessionId: string,
  opts?: { force?: boolean; deletedFromDisk?: boolean },
): Promise<{ action: string }> =>
  request<SuccessEnvelope<{ sessionId: string; action: string }>>(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}?${
      new URLSearchParams({
        ...(opts?.force ? { force: 'true' } : {}),
        ...(opts?.deletedFromDisk === false ? { deletedFromDisk: 'false' } : {}),
      }).toString()
    }`,
    { method: 'DELETE' },
  ).then((body) => ({ action: body.data.action }));

/** Restores an archived session. */
export const restoreSession = (sessionId: string): Promise<void> =>
  request(`/api/providers/sessions/${encodeURIComponent(sessionId)}/restore`, {
    method: 'POST',
  }).then(() => undefined);

/** Toggles a project's starred flag. */
export const toggleStar = (projectId: string): Promise<{ isStarred: boolean }> =>
  request<{ success: boolean; isStarred: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/toggle-star`,
    { method: 'POST' },
  ).then((body) => ({ isStarred: body.isStarred }));

//----------------- Providers, models, usage ------------

/** Capability matrix for model/image/effort gating in the composer. */
export const fetchCapabilities = (): Promise<{ providers: ProviderCapability[] }> =>
  request<SuccessEnvelope<{ providers: ProviderCapability[] }>>(
    '/api/providers/capabilities',
  ).then((body) => body.data);

/** Model catalog (predefined + custom) for one provider. */
export const fetchModels = (
  provider: LLMProvider,
): Promise<{ options: ModelOption[]; default: string }> =>
  request<SuccessEnvelope<{ provider: string; models: ModelsCatalog }>>(
    `/api/providers/${encodeURIComponent(provider)}/models`,
  ).then((body) => ({
    options: body.data.models.OPTIONS ?? [],
    default: body.data.models.DEFAULT,
  }));

/** Custom agent record for one provider (`GET /:provider/agents`). */
export type ProviderAgent = {
  name: string;
  description: string;
  scope: string;
  sourcePath: string;
};

/** Custom agents visible for one provider and optional workspace. */
export const fetchAgents = (
  provider: LLMProvider,
  workspacePath?: string,
): Promise<{ agents: ProviderAgent[] }> =>
  request<SuccessEnvelope<{ provider: string; agents: ProviderAgent[] }>>(
    `/api/providers/${encodeURIComponent(provider)}/agents${
      workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : ''
    }`,
  ).then((body) => ({ agents: body.data.agents ?? [] }));

/** Which model + effort one session currently runs with. */
export const fetchActiveModel = (
  provider: LLMProvider,
  sessionId: string,
): Promise<SessionModelState> =>
  request<SuccessEnvelope<SessionModelState>>(
    `/api/providers/${encodeURIComponent(provider)}/sessions/${encodeURIComponent(sessionId)}/active-model`,
  ).then((body) => body.data);

/** Per-session model override. */
export const setActiveModel = (provider: LLMProvider, sessionId: string, model: string): Promise<void> =>
  request(`/api/providers/${encodeURIComponent(provider)}/sessions/${encodeURIComponent(sessionId)}/active-model`, {
    method: 'POST',
    body: JSON.stringify({ model }),
  }).then(() => undefined);

/** Per-session effort override. */
export const setActiveEffort = (provider: LLMProvider, sessionId: string, effort: string): Promise<void> =>
  request(`/api/providers/${encodeURIComponent(provider)}/sessions/${encodeURIComponent(sessionId)}/active-effort`, {
    method: 'POST',
    body: JSON.stringify({ effort }),
  }).then(() => undefined);

/** Token usage for the usage header (no cost field exists server-side). */
export const fetchTokenUsage = (sessionId: string): Promise<TokenUsage> =>
  request<SuccessEnvelope<TokenUsage>>(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}/token-usage`,
  ).then((body) => body.data);

export type ImageUploadSource = { uri: string; name?: string | null; mimeType?: string | null };

/**
 * Stores chat images in the server's global assets folder. Returns one
 * `{path, name, mimeType, size}` descriptor per file — the shape
 * `chat.send` options carry as `attachments` (the websocket gateway
 * re-validates them against the upload store before providers see them).
 */
export const uploadImages = async (files: ImageUploadSource[]): Promise<StoredAttachment[]> => {
  if (!auth) throw new Error('Not signed in');
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) {
    form.append('images', {
      uri: file.uri,
      name: file.name || 'image.jpg',
      type: file.mimeType || 'image/jpeg',
    } as unknown as Blob);
  }
  // No Content-Type header: fetch sets the multipart boundary itself.
  const response = await fetch(`${auth.baseUrl}/api/assets/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
    body: form,
  });
  if (response.status === 401) throw new Error('Session expired — sign in again');
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Image upload failed (${response.status})`);
  }
  const body = (await response.json()) as { images?: StoredAttachment[] };
  if (!Array.isArray(body.images) || body.images.length !== files.length) {
    throw new Error('Image upload returned an incomplete result');
  }
  return body.images;
};
