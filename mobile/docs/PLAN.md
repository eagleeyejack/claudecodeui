# CloudCLI Mobile — plan, decisions, and runbook

Expo (React Native) companion client for the CloudCLI web UI. The phone never
runs the CLIs; it is a thin client over the existing Node server's REST + WebSocket
API. Zero server changes so far.

## What exists today (M0–M2, branch `mobile`, commit `1607a04`)

- `src/lib/api.ts` — typed REST client. Auth = the same JWT the web app uses
  (`POST /api/auth/login` → `Authorization: Bearer`). REST surface used:
  - `GET /health`
  - `GET /api/projects?skipSynchronization=1` (projects with sessions, fast read)
  - `GET /api/providers/sessions/:sessionId/messages` (history; wrapped in
    `createApiSuccessResponse` server-side)
- `src/lib/ws.ts` — `ChatSocket`: connects `ws(s)://<server>/ws?token=<jwt>`
  (RN WebSockets cannot set headers; the server already accepts `?token=`).
  Frames mirror the web client exactly:
  - `{type:'chat.subscribe', sessions:[{sessionId, lastSeq}]}` — server replays
    events after `lastSeq`, so reconnects never miss messages
  - `{type:'chat.send', sessionId, content, options:{}}`
  - `{type:'chat.abort', sessionId}`
  - tracks `seq` per session, resubscribes on reconnect, exponential backoff (1s→30s)
- `src/screens/ConnectScreen.tsx` — server URL + username/password → JWT,
  persisted in SecureStore via `src/lib/store.ts`
- `src/screens/ProjectsScreen.tsx` — projects + recent sessions
- `src/screens/ChatScreen.tsx` — inverted FlatList transcript, streaming text,
  tool calls rendered as collapsed rows, composer, Stop button
- `App.tsx` — 3-route state machine (Connect → Projects → Chat) + live/offline dot

Verified so far: `tsc --noEmit` clean, `expo export --platform ios` bundles
(1.5 MB Hermes bytecode), Metro serves over Tailscale, app loads in Expo Go.

## Runbook (how we run it right now)

```bash
# Mac: dev server, advertised over Tailscale (ngrok tunnels were flaky — avoid)
cd ~/Code/claudecodeui/mobile
REACT_NATIVE_PACKAGER_HOSTNAME=$( /Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 | head -1 ) \
  npx expo start --port 8081
# Expo Go on the phone → exp://100.88.183.93:8081 (Tailscale IP, works off Wi-Fi)

# Mac: the app server itself (already a LaunchAgent)
launchctl list | grep cloudcli        # com.eagleeyejack.cloudcli, port 3450
tail -f ~/Library/Logs/cloudcli.log   # server logs
```

Expo CLI is logged in as `eagleeyejack` (needed later for EAS builds only).

## Known issues (next session's first hour)

1. **Login "fetch failed / hostname could not be found" (iOS NSURLError -1003).**
   Diagnosis: the Connect screen defaults to `http://localhost:3450`, which on a
   phone means the phone itself — never works. The Tailscale *hostname* also
   failed to resolve, which means the phone's tailnet DNS wasn't active at that
   moment (Tailscale app signed out / VPN toggle off / on cellular without the
   VPN). Fix plan, in order:
   - Try the tailnet **IP** directly: `http://100.88.183.93:3450` — no DNS needed.
   - Or the LAN IP when on home Wi-Fi (`ipconfig getifaddr en0`).
   - Blank the `localhost` default in ConnectScreen; persist last-successful URL.
   - If plain `http://<ip>` is blocked (App Transport Security) once we ship a
     dev build, add `NSAppTransportSecurity.NSAllowsArbitraryLoads` to
     `app.json` → `expo.ios.infoPlist` (Expo Go already permits it).
   - Sanity gate before blaming RN: open the same URL in Safari on the phone.
2. Streaming: message ids differ between the optimistic local echo and the
   server's own user row — dedupe by `role==='user'` + content+timestamp window
   instead of dropping one.
3. Tool rows are 3-line truncated text — fine for v1.

## Testing plan (write now, implement next session)

Layered, cheapest first — no device farm needed:

1. **Unit (jest-expo + jest, in `mobile/`)**
   - `api.ts`: URL normalization (trailing slash, missing scheme), 401 →
     "Session expired", success-response unwrap for the messages endpoint
     (mock `fetch`).
   - `ws.ts`: subscribe/resubscribe frame shapes (mock WebSocket), `lastSeq`
     tracking across a simulated disconnect/reconnect, backoff caps at 30 s.
   - Pure logic only; no RN components.
2. **Component (`@testing-library/react-native`)**
   - ConnectScreen: validation errors, calls `healthCheck` before `login`,
     stores auth on success.
   - ChatScreen: renders history, appends live frames by id, replaces on
     duplicate id (streaming), tool vs text rendering.
3. **Contract (live server, still automated)**
   - Node script hitting the real server on 3450: login → projects →
     messages → WS subscribe + send echo of user row. Runs only when
     `CLOUDCLI_CONTRACT_URL` is set, so CI skips it locally.
4. **Device E2E (Maestro, later)**
   - Flow: install Expo Go build → connect → open latest session → send
     "ping" → assert a reply bubble appears. One YAML file, runs on a
     simulator once we add an iOS dev build via `eas build --profile development`.

## M3 backlog (after the client is stable)

- Markdown/code-block rendering (react-native-markdown-display or custom)
- Image attachments via `/api/assets`
- Push notifications on run-complete (needs EAS dev build, not Expo Go)
- Named tunnels vs tailnet-only distribution decision
- Provider/model picker from `/api/providers`

## Open-source route (decided)

Upstream-first: build M0–M2 to demo-quality, record a clip, open a
Discussion on `siteboon/claudecodeui` proposing the companion client (zero
server changes, reuses WS protocol + auth), then PR in stages if invited.
Keep AGPL-3.0 if it ever splits into its own repo.
