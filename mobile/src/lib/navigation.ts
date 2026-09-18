/** Navigation param lists (drawer destinations + stack). */
import type { ProjectSummary, SessionSummary } from '@/lib/api';

export type RootStackParamList = {
  Connect: undefined;
  Projects: undefined;
  NewSession: undefined;
  Archive: undefined;
  Settings: undefined;
  /** Chat accepts full objects (in-app nav) or bare ids (deep links). */
  Chat: { project?: ProjectSummary; session?: SessionSummary; projectId?: string; sessionId?: string };
};

export const CHAT_LINK_PREFIX = 'exp://';
