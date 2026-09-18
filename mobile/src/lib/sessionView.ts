/**
 * Presentation data derived from a session before rendering its row.
 * Lifted from the web app's `sidebarProjectFormatting.ts` so rows, search
 * results and notifications share one definition of recency and naming.
 */
import type { LLMProvider } from '@/lib/api';

export type SessionLike = {
  id?: string;
  sessionId?: string;
  provider?: LLMProvider;
  summary?: string | null;
  title?: string | null;
  messageCount?: number;
  lastActivity?: string;
};

export type SessionViewModel = {
  /** Stable key for list rendering. */
  key: string;
  /** Display name: summary → title → "New session". */
  name: string;
  /** Compact age: `<1m`, `5m`, `3hr`, `2d`, or '' when unknown. */
  age: string;
  /** Active within the last 10 minutes (green dot, like the web sidebar). */
  isActive: boolean;
  messageCount: number;
  provider: LLMProvider | undefined;
};

export const formatCompactAge = (
  dateString: string | null | undefined,
  now: Date = new Date(),
): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}hr` : `${Math.floor(hours / 24)}d`;
};

export const sessionNameOf = (session: SessionLike): string =>
  session.summary || session.title || 'New session';

export const createSessionViewModel = (
  session: SessionLike,
  projectKey: string,
  now: Date = new Date(),
): SessionViewModel => {
  const id = session.id ?? session.sessionId ?? '';
  const lastActivity = session.lastActivity ?? '';
  const date = new Date(lastActivity);
  const diffMinutes = Number.isNaN(date.getTime())
    ? Number.POSITIVE_INFINITY
    : (now.getTime() - date.getTime()) / 60000;
  return {
    key: `${projectKey}:${id}`,
    name: sessionNameOf(session),
    age: formatCompactAge(lastActivity, now),
    isActive: diffMinutes < 10,
    messageCount: Number(session.messageCount || 0),
    provider: session.provider,
  };
};

/** Newest-first by last activity; rows without timestamps sink to the bottom. */
export const sortSessionsNewestFirst = <T extends SessionLike>(sessions: T[]): T[] =>
  [...sessions].sort(
    (a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime(),
  );
