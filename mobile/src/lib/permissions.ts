/**
 * Tool-permission helpers ported from the web client's
 * `src/modules/chat/utils/chatPermissions.ts`.
 *
 * The server resolves approvals by `requestId` (`chat.permission-response`
 * carries `{requestId, allow, updatedInput?, message?, rememberEntry?}`),
 * and a `rememberEntry` is persisted into the runtime's allowed-tools list —
 * so it must be a real rule (`ToolName` or `Bash(cmd:*)`), never free text.
 */

/** A tool-permission request awaiting the user's decision. */
export type PendingPermissionRequest = {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
};

/**
 * Builds the allow-rule for "Allow & remember": the bare tool name, except
 * Bash which scopes to the command prefix (`Bash(npm:*)`, `Bash(git status:*)`).
 */
export function buildClaudeToolPermissionEntry(
  toolName?: string,
  toolInput?: unknown,
): string | null {
  if (!toolName) return null;
  if (toolName !== 'Bash') return toolName;

  let parsed: unknown = toolInput;
  if (typeof toolInput === 'string') {
    try {
      parsed = JSON.parse(toolInput) as unknown;
    } catch {
      return toolName;
    }
  }

  const command =
    parsed && typeof parsed === 'object' && 'command' in parsed && typeof parsed.command === 'string'
      ? parsed.command.trim()
      : '';
  if (!command) return toolName;

  const tokens = command.split(/\s+/);
  if (tokens.length === 0) return toolName;

  if (tokens[0] === 'git' && tokens[1]) {
    return `Bash(${tokens[0]} ${tokens[1]}:*)`;
  }
  return `Bash(${tokens[0]}:*)`;
}

/** Human-readable tool input for the approval prompt body. */
export function formatToolInputForDisplay(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** Title + body for the native approval Alert. */
export function describePermissionRequest(request: PendingPermissionRequest): {
  title: string;
  message: string;
} {
  const entry = buildClaudeToolPermissionEntry(request.toolName, request.input);
  const detail = formatToolInputForDisplay(request.input);
  const lines = [`${request.toolName} is asking for approval.`];
  if (entry && entry !== request.toolName) {
    lines.push(`Allow rule: ${entry}`);
  }
  if (detail) {
    const trimmed = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
    lines.push('', trimmed);
  }
  return { title: 'Permission required', message: lines.join('\n') };
}
