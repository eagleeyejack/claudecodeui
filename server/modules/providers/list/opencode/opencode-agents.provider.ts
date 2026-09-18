import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { IProviderAgents } from '@/shared/interfaces.js';
import type {
  LLMProvider,
  ProviderAgent,
  ProviderAgentListOptions,
  ProviderSkillScope,
} from '@/shared/types.js';
import {
  findTopmostGitRoot,
  readProviderSkillMarkdownDefinitionFromContent,
} from '@/shared/utils.js';

const OPENCODE_PROJECT_AGENT_DIRS = [
  ['.opencode', 'agents'],
  ['.opencode', 'agent'],
];

const OPENCODE_USER_AGENT_DIRS = [
  ['.config', 'opencode', 'agents'],
  ['.config', 'opencode', 'agent'],
];

/**
 * Names the OpenCode CLI accepts without a user-defined agent file.
 *
 * `build` is the default agent (sent as no flag); `plan` is the built-in
 * read-only agent. Both are valid `--agent` values on any install.
 */
export const OPENCODE_BUILT_IN_AGENTS = ['build', 'plan'] as const;

/**
 * Agent names that survive the trust boundary into `opencode run --agent`.
 *
 * Names come from agent markdown filenames, so the pattern stays close to
 * slug rules and rejects path separators, whitespace, and shell metacharacters.
 */
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const stripMarkdownExtension = (value: string): string => value.replace(/\.md$/i, '');

const resolveWorkspacePath = (workspacePath?: string): string =>
  path.resolve(workspacePath ?? process.cwd());

/**
 * Reads one agent markdown file into a normalized record.
 *
 * Agent files share the skill front matter shape (`name`/`description`), so
 * the skill parser is reused with the filename as the fallback name. Returns
 * null for unreadable files or names the CLI could never accept.
 */
const readAgentFile = async (
  agentPath: string,
  provider: LLMProvider,
  scope: ProviderSkillScope,
): Promise<ProviderAgent | null> => {
  let content: string;
  try {
    content = await readFile(agentPath, 'utf8');
  } catch {
    return null;
  }
  let definition;
  try {
    definition = readProviderSkillMarkdownDefinitionFromContent(
      content,
      stripMarkdownExtension(path.basename(agentPath)),
    );
  } catch {
    // A malformed front matter block (unquoted colons are common in prose
    // descriptions) must not hide every other valid agent.
    return null;
  }
  const name = definition.name.trim();
  if (!AGENT_NAME_PATTERN.test(name)) {
    return null;
  }
  return { provider, name, description: definition.description, scope, sourcePath: agentPath };
};

/**
 * Lists `<name>.md` agent files directly under one root directory.
 *
 * Missing or unreadable roots return an empty list because users may not have
 * every agent folder on every machine. Symlinked folders (for example a shared
 * agent library) resolve through `readdir` on the link itself.
 */
const listAgentFiles = async (rootDir: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith('.md'),
    )
    .map((entry) => path.join(rootDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
};

/** Provider registry agent adapter for OpenCode custom agents. */
export class OpenCodeAgentsProvider implements IProviderAgents {
  protected readonly provider: LLMProvider = 'opencode';

  async listAgents(options?: ProviderAgentListOptions): Promise<ProviderAgent[]> {
    const workspacePath = resolveWorkspacePath(options?.workspacePath);
    const repoRoot = await findTopmostGitRoot(workspacePath);
    const agents: ProviderAgent[] = [];
    // First record wins per name, so project agents shadow user agents the
    // same way the CLI resolves them.
    const seenNames = new Set<string>();

    const collectFrom = async (rootDir: string, scope: ProviderSkillScope): Promise<void> => {
      for (const agentPath of await listAgentFiles(rootDir)) {
        const agent = await readAgentFile(agentPath, this.provider, scope);
        if (!agent || seenNames.has(agent.name)) {
          continue;
        }
        seenNames.add(agent.name);
        agents.push(agent);
      }
    };

    // Project roots from the workspace up to the topmost git root, mirroring
    // the OpenCode skills provider search.
    const projectRoots: string[] = [];
    let currentPath = workspacePath;
    while (true) {
      projectRoots.push(currentPath);
      if (!repoRoot || path.resolve(currentPath) === path.resolve(repoRoot)) {
        break;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }
    for (const projectRoot of projectRoots) {
      for (const agentDir of OPENCODE_PROJECT_AGENT_DIRS) {
        await collectFrom(path.join(projectRoot, ...agentDir), 'project');
      }
    }

    for (const agentDir of OPENCODE_USER_AGENT_DIRS) {
      await collectFrom(path.join(os.homedir(), ...agentDir), 'user');
    }

    return agents.sort((left, right) => left.name.localeCompare(right.name));
  }
};

/**
 * Validates a client-requested agent name against this install's agents.
 *
 * Consumed by the OpenCode runtime to build the `--agent` flag: built-ins and
 * discovered custom agents pass through, while `build` (the default), unknown
 * names, and malformed values resolve to no flag so the run keeps the default
 * agent instead of failing with an invalid-agent error.
 */
export async function listOpenCodeAgentNames(workspacePath?: string): Promise<string[]> {
  const provider = new OpenCodeAgentsProvider();
  const agents = await provider.listAgents({ workspacePath });
  return [...OPENCODE_BUILT_IN_AGENTS, ...agents.map((agent) => agent.name)];
}
