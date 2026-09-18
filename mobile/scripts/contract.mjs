/**
 * Live-server contract test for the mobile client (JAA-228).
 *
 * Hits the real CloudCLI server and asserts the exact shapes `mobile/src/lib/api.ts`
 * and `mobile/src/lib/ws.ts` depend on:
 *   GET /health -> {status:'ok', ...}
 *   POST /api/auth/login -> {success, user, token}
 *   GET /api/projects?skipSynchronization=1 -> RAW array of {projectId, displayName, sessions[]}
 *   GET /api/providers/sessions/:id/messages -> {success:true, data:{messages[], total, ...}}
 *   WS /ws?token= -> chat.subscribe receives a `chat_subscribed` ack
 *
 * Runs only when CLOUDCLI_CONTRACT_URL is set (e.g. http://127.0.0.1:3450),
 * so plain `npm test` / CI never touches the network.
 * Credentials via CLOUDCLI_CONTRACT_USER / CLOUDCLI_CONTRACT_PASSWORD.
 * Set CLOUDCLI_CONTRACT_SEND=1 to also exercise `chat.send` (triggers a real
 * agent run on the target session — off by default to avoid side effects).
 */
import WebSocket from 'ws';

const BASE = process.env.CLOUDCLI_CONTRACT_URL ?? '';
if (!BASE) {
  console.log('contract: skipped (CLOUDCLI_CONTRACT_URL not set)');
  process.exit(0);
}
const USER = process.env.CLOUDCLI_CONTRACT_USER ?? '';
const PASS = process.env.CLOUDCLI_CONTRACT_PASSWORD ?? '';
if (!USER || !PASS) {
  console.error('contract: CLOUDCLI_CONTRACT_USER and CLOUDCLI_CONTRACT_PASSWORD are required');
  process.exit(1);
}
const SHOULD_SEND = process.env.CLOUDCLI_CONTRACT_SEND === '1';

const base = BASE.replace(/\/+$/, '');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await (await fetch(`${base}/health`)).json();
check('GET /health', health?.status === 'ok', JSON.stringify(health)?.slice(0, 120));

const loginRes = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const login = await loginRes.json().catch(() => ({}));
check('POST /api/auth/login', loginRes.ok && typeof login?.token === 'string', `status=${loginRes.status}`);
if (!login?.token) process.exit(1);
const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

const projectsRes = await fetch(`${base}/api/projects?skipSynchronization=1`, { headers: authHeaders });
const projects = await projectsRes.json().catch(() => null);
check(
  'GET /api/projects is a raw array with projectId/displayName',
  Array.isArray(projects) && projects.every((p) => typeof p?.projectId === 'string' && typeof p?.displayName === 'string'),
  Array.isArray(projects) ? `${projects.length} projects` : `status=${projectsRes.status}`,
);

const firstSession = Array.isArray(projects)
  ? projects.flatMap((p) => (p.sessions ?? []).map((s) => s)).find((s) => s?.id)
  : null;
// A seeded server has sessions; a fresh one does not. Either way the WS
// subscribe path is exercised — with a probe id when there is nothing real.
const probeSessionId = firstSession?.id ?? 'contract-probe';
check(
  'at least one session exists',
  !!firstSession,
  firstSession?.id ?? 'fresh server — WS probed with contract-probe id',
);

{
  const msgRes = await fetch(
    `${base}/api/providers/sessions/${encodeURIComponent(probeSessionId)}/messages`,
    { headers: authHeaders },
  );
  const msgBody = await msgRes.json().catch(() => null);
  if (firstSession) {
    check(
      'GET messages envelope is {success, data:{messages[]}}',
      msgRes.ok && msgBody?.success === true && Array.isArray(msgBody?.data?.messages),
      `status=${msgRes.status}`,
    );
  } else {
    check('GET messages on fresh server does not 500', msgRes.status !== 500, `status=${msgRes.status}`);
  }

  await new Promise((resolve) => {
    const wsBase = base.replace(/^http/, 'ws');
    const socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(login.token)}`);
    const timer = setTimeout(() => {
      check('WS chat_subscribed ack', false, 'timed out after 15s');
      socket.close();
      resolve();
    }, 15000);
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: probeSessionId, lastSeq: 0 }] }));
      if (SHOULD_SEND && firstSession) {
        socket.send(JSON.stringify({ type: 'chat.send', sessionId: probeSessionId, content: 'contract ping', options: {} }));
      }
    });
    socket.on('message', (raw) => {
      try {
        const frame = JSON.parse(String(raw));
        if (frame?.type === 'chat_subscribed' || frame?.kind === 'chat_subscribed') {
          check('WS chat_subscribed ack', true, `session=${frame.sessionId ?? probeSessionId}`);
          clearTimeout(timer);
          socket.close();
          resolve();
        }
      } catch { /* ignore malformed frames, like the client */ }
    });
    socket.on('error', (cause) => {
      check('WS chat_subscribed ack', false, String(cause?.message ?? cause));
      clearTimeout(timer);
      resolve();
    });
  });
}

//----------------- Phase 2/3 management endpoints (all used by the mobile UI) ------------
{
  const authed = (path, init) => fetch(`${base}${path}`, { ...init, headers: authHeaders });
  const asJson = (res) => res.json().catch(() => ({}));

  const caps = await asJson(await authed('/api/providers/capabilities'));
  check(
    'GET capabilities lists providers',
    caps?.success === true && Array.isArray(caps?.data?.providers) && caps.data.providers.length > 0,
    caps?.data?.providers?.map((p) => p.provider).join(',') ?? '',
  );

  const provider = caps?.data?.providers?.[0]?.provider ?? 'opencode';
  const models = await asJson(await authed(`/api/providers/${provider}/models`));
  check(
    'GET models returns {OPTIONS, DEFAULT} catalog',
    models?.success === true && models?.data?.models?.OPTIONS && typeof models?.data?.models?.DEFAULT === 'string',
    `${provider}: ${models?.data?.models?.OPTIONS?.length ?? 0} options`,
  );

  if (firstSession) {
    const usage = await asJson(await authed(`/api/providers/sessions/${firstSession.id}/token-usage`));
    check(
      'GET token-usage returns usage shape',
      usage?.success === true && typeof usage?.data === 'object',
      JSON.stringify(usage?.data)?.slice(0, 80) ?? '',
    );

    const detail = await asJson(await authed(`/api/providers/sessions/${firstSession.id}`));
    const originalSummary = detail?.data?.summary ?? detail?.summary ?? 'contract probe';
    const renamed = await authed(`/api/providers/sessions/${firstSession.id}`, {
      method: 'PUT',
      body: JSON.stringify({ summary: 'contract probe rename' }),
    });
    check('PUT rename session', renamed.ok, `status=${renamed.status}`);
    const restored = await authed(`/api/providers/sessions/${firstSession.id}`, {
      method: 'PUT',
      body: JSON.stringify({ summary: originalSummary }),
    });
    check('PUT rename session (restore original)', restored.ok, `status=${restored.status}`);

    const archived = await asJson(await authed(`/api/providers/sessions/${firstSession.id}`, { method: 'DELETE' }));
    check(
      'DELETE session archives',
      archived?.data?.action === 'archived',
      archived?.data?.action ?? JSON.stringify(archived)?.slice(0, 80),
    );
    const unarchived = await authed(`/api/providers/sessions/${firstSession.id}/restore`, { method: 'POST' });
    check('POST session restore', unarchived.ok, `status=${unarchived.status}`);
  }

  if (Array.isArray(projects) && projects.length > 0) {
    const target = projects[0];
    const starred = await asJson(await authed(`/api/projects/${target.projectId}/toggle-star`, { method: 'POST' }));
    const back = await asJson(await authed(`/api/projects/${target.projectId}/toggle-star`, { method: 'POST' }));
    check(
      'POST toggle-star round-trips',
      typeof starred?.isStarred === 'boolean' && back?.isStarred !== starred.isStarred,
      `${target.displayName}: ${starred?.isStarred} → ${back?.isStarred}`,
    );
  }
}

process.exit(failures ? 1 : 0);