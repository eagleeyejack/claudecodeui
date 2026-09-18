/** Shared helpers for the chat transcript (Phase 3a): order, usage, timestamps. */
import type { ChatMessage, TokenUsage } from '@/lib/api';

/**
 * Web parity: thinking turns never render as plain bubbles (web `Reasoning`).
 * Matches the `isThinking` flag or a `thinking`-kind row.
 */
export const isThinkingMessage = (message: ChatMessage): boolean =>
  message.isThinking === true || message.kind === 'thinking';

/** Compact token counts for the usage header: 999 -> "999", 12345 -> "12.3K", 200000 -> "200K". */
export const formatCompact = (value: number): string => {
  if (value < 1000) return `${value}`;
  const thousands = value / 1000;
  return Number.isInteger(thousands) ? `${thousands}K` : `${thousands.toFixed(1)}K`;
};

/**
 * Compact "12.3K / 200K" usage line, or null when there is nothing to show
 * (unsupported provider, fetch failure, or empty payload).
 */
export const formatUsageLine = (usage: TokenUsage): string | null => {
  if (usage.unsupported) return null;
  const hasUsed =
    usage.used !== undefined || usage.inputTokens !== undefined || usage.outputTokens !== undefined;
  if (!hasUsed && usage.total === undefined) return null;
  const used = usage.used ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (usage.total === undefined) return formatCompact(used);
  return `${formatCompact(used)} / ${formatCompact(usage.total)}`;
};

/** Short clock time under each bubble; '' when the timestamp is unparseable. */
export const formatTimestamp = (iso: string): string => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleTimeString();
};
