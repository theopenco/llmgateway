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

For `e2e/chat.yaml`, build the stack and start the local API, then run these in
separate terminals with the same isolated environment loaded:

```sh
pnpm --filter mobile test:upstream
pnpm --filter mobile test:gateway
```

The launcher replaces environment provider credentials with the OpenAI mock at
`GATEWAY_PORT + 8`. The flows select the seeded test organization. Stop both
processes after testing.

Verified during development:

- Full repository build: 20 workspaces passed.
- Repository unit suite: 7,058 passed, 2 skipped; chat history/search tests: 7 passed.
- Native tests: 72 passed; shared image configuration tests: 3 passed.
- Signed Release build launched on the iOS simulator with local service URLs.
- Maestro account flow: sign-in errors, session restoration, workspace switching,
  project and skill persistence/deletion, profile access, and sign-out passed.
- Maestro chat flow with a mock provider: generation, retry without duplicate
  messages, pinning, restart persistence, archive/restore, and deletion passed.
- Native chat controls: editing, forking, renaming, saved settings, temporary
  conversations, reasoning, draft preservation, stopping, and attachment
  persistence through restart/retry/edit passed.
- Native history search: message text, restart persistence, archived results,
  and restoring a match to active history passed.
- Native model selection: provider pinning, favorites across restart, removing
  favorites, and switching back to Auto passed.
- Native citations: source links and web-search settings survived restart.
- Native sharing: public links, fork permissions, pasted-link reading, revocation,
  workspace snapshots, and forking into a conversation passed.
- Native group discussion: five alternating turns, transcript sharing, starting
  over, stopping, and continuing with the next model passed.
- Native image checks with a mock provider: generation/editing, model comparison,
  settings, history after restart, Files export/import, sharing, renaming, and
  deletion passed. Exported PNG bytes matched the generated fixture.
  The iOS 26 Files picker needs the coordinate taps documented in the flows.
  Rerun the complete flows after later app changes.

Additional chat flows cover controls, streaming, sources, and sharing in
`e2e/chat-*.yaml`. Run `e2e/images.yaml` before `e2e/chat-attachments.yaml`
to place its generated PNG in Files.

The Markdown renderer patch supplies accessibility bounds alongside its
VoiceOver outlines so iOS automation can inspect rendered text.

## Delivery checklist

A checkbox requires observed behavior, not just a screen or passing type check.

- [ ] Sign-in, secure session restoration, sign-out, signup/reset, account deletion
- [ ] Chat: streaming, model selection/favorites, search, reasoning, attachments, web search, stop/retry/edit/fork, settings
- [ ] History: synchronization, search, pin, archive, delete, public and organization sharing
- [ ] Model comparison and group conversations
- [ ] Projects: instructions, files, retrieval, memory, associated chats
- [ ] Skills: create, edit, generate, enable, delete, apply in chat
- [ ] Connectors: connect, authorize, use, disconnect
- [x] Image creation/editing, settings, multi-model comparison, history, save/share
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
