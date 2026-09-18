import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listOpenCodeAgentNames,
  OpenCodeAgentsProvider,
} from '@/modules/providers/list/opencode/opencode-agents.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const writeAgent = async (dir: string, fileName: string, description: string): Promise<string> => {
  await fs.mkdir(dir, { recursive: true });
  const agentPath = path.join(dir, fileName);
  const name = fileName.replace(/\.md$/i, '');
  await fs.writeFile(agentPath, `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`, 'utf8');
  return agentPath;
};

test('OpenCode lists custom agents from both user agent folders', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agents-user-'));
  const restoreHome = patchHomeDir(tempRoot);
  try {
    const agentsDir = path.join(tempRoot, '.config', 'opencode', 'agents');
    const agentDir = path.join(tempRoot, '.config', 'opencode', 'agent');
    await writeAgent(agentsDir, 'crew-builder.md', 'Builds the thing.');
    await writeAgent(agentDir, 'hormozi-copywriter.md', 'Writes copy.');
    await fs.writeFile(path.join(agentDir, 'notes.txt'), 'not an agent', 'utf8');

    const provider = new OpenCodeAgentsProvider();
    const agents = await provider.listAgents({ workspacePath: tempRoot });

    assert.deepEqual(
      agents.map((agent) => agent.name),
      ['crew-builder', 'hormozi-copywriter'],
    );
    assert.ok(agents.every((agent) => agent.provider === 'opencode'));
    assert.ok(agents.every((agent) => agent.scope === 'user'));
    assert.equal(agents[0].description, 'Builds the thing.');
    assert.equal(agents[0].sourcePath, path.join(agentsDir, 'crew-builder.md'));
  } finally {
    restoreHome();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('OpenCode project agents shadow user agents with the same name', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agents-shadow-'));
  const restoreHome = patchHomeDir(tempRoot);
  try {
    await writeAgent(
      path.join(tempRoot, '.config', 'opencode', 'agents'),
      'scout.md',
      'User scout.',
    );
    const workspacePath = path.join(tempRoot, 'work', 'proj');
    const projectAgentsDir = path.join(workspacePath, '.opencode', 'agents');
    await writeAgent(projectAgentsDir, 'scout.md', 'Project scout.');

    const provider = new OpenCodeAgentsProvider();
    const agents = await provider.listAgents({ workspacePath });

    assert.deepEqual(agents.map((agent) => agent.name), ['scout']);
    assert.equal(agents[0].scope, 'project');
    assert.equal(agents[0].description, 'Project scout.');
  } finally {
    restoreHome();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('OpenCode agent listing tolerates missing folders and bad names', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agents-empty-'));
  const restoreHome = patchHomeDir(tempRoot);
  try {
    const provider = new OpenCodeAgentsProvider();
    assert.deepEqual(await provider.listAgents({ workspacePath: tempRoot }), []);

    // Filenames that can never be valid --agent values are skipped.
    const agentsDir = path.join(tempRoot, '.config', 'opencode', 'agents');
    await writeAgent(agentsDir, 'not an agent.md', 'Bad name.');
    assert.deepEqual(await provider.listAgents({ workspacePath: tempRoot }), []);
  } finally {
    restoreHome();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('listOpenCodeAgentNames includes built-ins plus customs', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agents-names-'));
  const restoreHome = patchHomeDir(tempRoot);
  try {
    await writeAgent(
      path.join(tempRoot, '.config', 'opencode', 'agents'),
      'crew-architect.md',
      'Plans.',
    );
    const names = await listOpenCodeAgentNames(tempRoot);
    assert.ok(names.includes('build'));
    assert.ok(names.includes('plan'));
    assert.ok(names.includes('crew-architect'));
  } finally {
    restoreHome();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
