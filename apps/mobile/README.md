# The Lounge for iOS

Bare React Native app for Lounge by LLM Gateway. Payments remain on the web.

From the repository root:

```sh
pnpm install
pnpm exec turbo run build --filter=mobile
pnpm --filter mobile pods
pnpm --filter mobile start
pnpm --filter mobile ios
```

## Local verification

Use an isolated stack from the root `AGENTS.md`. Set `LOUNGE_API_URL`,
`LOUNGE_GATEWAY_URL` (including `/v1`), and `LOUNGE_WEB_URL` when building the
simulator app to use that stack. Without overrides, builds use production URLs.
Restart Metro with `--reset-cache` after changing these values.

```sh
pnpm --filter mobile test
maestro test apps/mobile/e2e/account-and-workspaces.yaml
```

Run suites sequentially. The Maestro flow needs an app built for the seeded
local API and clears the simulator's Keychain. Use a dedicated test simulator.

Verified during development:

- Full repository build: 20 workspaces passed.
- Repository unit suite: 7,058 passed, 2 skipped; archive history tests: 3 passed.
- Native tests: 21 passed.
- Signed Release build launched on the iOS simulator with local service URLs.
- Maestro account flow: sign-in errors, session restoration, workspace switching,
  project and skill persistence/deletion, profile access, and sign-out passed.

## Delivery checklist

A checkbox requires observed behavior, not just a screen or passing type check.

- [ ] Sign-in, secure session restoration, sign-out, signup/reset, account deletion
- [ ] Chat: streaming, model selection/favorites, search, reasoning, attachments, web search, stop/retry/edit/fork, settings
- [ ] History: synchronization, search, pin, archive, delete, public and organization sharing
- [ ] Model comparison and group conversations
- [ ] Projects: instructions, files, retrieval, memory, associated chats
- [ ] Skills: create, edit, generate, enable, delete, apply in chat
- [ ] Connectors: connect, authorize, use, disconnect
- [ ] Image creation/editing, settings, multi-model comparison, history, save/share
- [ ] Video creation, input frames, polling, playback, history, save/share
- [ ] Speech generation/transcription, playback, history
- [ ] Realtime voice calls and call history
- [ ] Canvas generation and interactive rendering
- [ ] Escape gameplay and saved runs
- [ ] Profile, points, levels, streaks, leaderboard
- [ ] Organization switching, membership/usage, web-only payments
- [ ] Accessibility, keyboard/safe-area handling, light/dark appearance
- [ ] Component/unit tests, isolated backend tests, complete iOS e2e flows
- [x] Production JavaScript bundle and signed simulator build
- [ ] Signed device archive
- [ ] Recorded simulator demo
- [ ] TestFlight upload and successful processing under the requested account

Production configuration lives in `src/config.ts`. Do not publish credentials or
local test recordings containing personal accounts. Test against seeded local data.
