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
`LOUNGE_GATEWAY_URL` (including `/v1`), `LOUNGE_WEB_URL`, and
`LOUNGE_ACCOUNT_URL` (the main account website) when building the simulator app
to use that stack. Without overrides, builds use production URLs.
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

The launcher replaces environment provider credentials with OpenAI, xAI, and Gemini mocks at
`GATEWAY_PORT + 8`. The flows select the seeded test organization. Stop both
processes after testing.

For `e2e/connectors.yaml`, start the API with `pnpm --filter mobile test:api`
and the same isolated environment. This launcher replaces connector OAuth and
mailbox requests with the local upstream fixture. The flow uses the system
sign-in browser and the API's real session checks and encrypted credential store.

For `e2e/accounts.yaml`, run `pnpm --filter mobile test:account-api` in place of
the normal API launcher, alongside the mock upstream and the main UI. Build the
app with `LOUNGE_ACCOUNT_URL` pointing to that UI. This enables hosted account
verification, captures mail for disposable `native-account-<timestamp>@example.test`
accounts, and disables external mail/contact notifications. The flow verifies an
email, resets the password in Safari, and deletes only the account it created.

For `e2e/browser-sign-in.yaml`, run the API and main UI with the same isolated
stack and build with the matching `LOUNGE_ACCOUNT_URL`. It uses the real device
authorization endpoints and system browser; the seeded account approves a new
session, then tests restoration, sign-out, denial, and cancellation. Browser
sign-in requires the native client allowlist in the API and the device approval
page to be deployed together.

The browser signup return-path suite uses the account-mail fixture above:
`PW_BASE_URL=<main-ui-url> LOUNGE_ACCOUNT_FIXTURE_URL=<mock-upstream-url> pnpm --filter ui test:e2e e2e/signup-return.pw.ts`.
To include mocked social signup, start only the UI with dummy `GITHUB_CLIENT_ID`
and `GOOGLE_CLIENT_ID` values and run with `PW_SOCIAL_AUTH_FIXTURE=true`.
Provider requests are intercepted; the email test verifies and deletes its own
disposable account using the real API.

`e2e/ipad-browser-signup.yaml` uses a fresh iPad simulator and the same account
fixture. It verifies signup in the app's browser, email verification and approval
in Safari, returning to the app, session restoration, and account deletion.

After signing in on the iPad, set its text size with
`xcrun simctl ui <device-id> content_size accessibility-extra-extra-extra-large`
and run `e2e/ipad-large-text.yaml`. It checks model/provider selection, draft
preservation, rotation, and keyboard controls. Restore the size with
`xcrun simctl ui <device-id> content_size large` before other flows.

For video flows, export a temporary `LOUNGE_TEST_VIDEO_SIGNING_KEY` and set
`LLM_VIDEO_CONTENT_JWT_SECRET` to the same value before starting the API.
Run `pnpm --filter mobile test:video-worker` alongside the mock and gateway.
This worker only polls video jobs. The fixture is a four-second synthetic MP4.

The iOS Podfile builds React Native core from source because the prebuilt
0.87 JSI headers conflict with Nitro video imports. The first build takes longer.

Canvas bundles the shared web component registry into an offline WebView. Run
`pnpm --filter mobile canvas:bundle` after editing its renderer; the mobile build
also regenerates it. Generation, model selection, editing, and exports use native
controls.

Audio playback uses Audio API with FFmpeg for the studio's encoded formats.
Its controls import Reanimated and Gesture Handler. The Audio API patch updates
two C++ calls to Worklets 0.12's `runSync` API.

Verified during development:

- Full repository build: 21 workspaces passed.
- Repository unit suite before the UTC revenue fix: 7,102 passed, 2 skipped,
  one admin date-range failure. After the fix, all five admin revenue tests pass
  under Stockholm, Los Angeles, and UTC timezones.
- Native tests: 331 passed; shared image configuration tests: 3 passed.
- Chat message persistence tests: 5 passed, including tool-only replies.
- Gateway speech tests: 20 passed.
- Video configuration: 25 passed; gateway video and byte-range tests: 57 passed.
- Signed Release build launched on the iOS simulator with local service URLs.
- Maestro account flow: sign-in errors, session restoration, workspace switching,
  project and skill persistence/deletion, profile access, and sign-out passed.
- Native email lifecycle: signup, email verification, Safari password reset,
  revoked sessions, rejected old passwords, deletion cancellation, permanent
  deletion, and rejected sign-in after deletion passed.
- Native browser sign-in: matching-code approval, session restoration after
  process restart, sign-out, denial, new-code recovery, and browser cancellation
  passed. Backend tests cover both native and CLI clients; browser tests also
  cover SSO return-path recovery.
- iPad browser signup: original verification email opened in Safari, matching-code
  approval, native sign-in, process restart, and account deletion passed.
- iPad maximum text size: model/provider selection, portrait and landscape
  composer visibility, keyboard editing, and draft preservation on rotation passed.
- Native workspace restoration: organization/project selection, chat billing and
  history after restart, switching back to personal, and clearing the choice on
  sign-out passed. An offline API required retry; an inactive saved project
  required an explicit replacement. Both recovered without an automatic switch.
- Maestro chat flow with a mock provider: generation, retry without duplicate
  messages, pinning, restart persistence, archive/restore, and deletion passed.
- Native chat controls: editing, forking, renaming, saved settings, temporary
  conversations, reasoning, draft preservation, stopping, and attachment
  persistence through restart/retry/edit passed.
- Native history search: message text, restart persistence, archived results,
  and restoring a match to active history passed.
- Native projects: file import/retrieval, manual memory editing/deletion, automatic
  learning across conversations and restart, file removal, project editing, and
  keeping conversations without context after project deletion passed.
- Native skills: cancel generation, review/edit a generated draft, save, restart,
  enable/disable, edit instructions, and delete passed. Gateway probes verified
  the expected instructions after each change.
- Native connector management: system-browser sign-in/cancellation, restart
  persistence, pause/resume, declined reconnection, and disconnect passed.
- Native conversation tools: explicit search/read approval, rejection, pending
  and completed history after restart, temporary history exclusion, and stopping
  an approved request before restarting and continuing without replay passed.
- Native model selection: provider pinning, favorites across restart, removing
  favorites, and switching back to Auto passed.
- Native citations: source links and web-search settings survived restart.
- Native sharing: public links, fork permissions, pasted-link reading, revocation,
  workspace snapshots, and forking into a conversation passed.
- Native comparison: three models, synchronized history after restart, retrying
  one model, opening its conversation, and stopping all models passed.
- Primary comparison tools: approval/rejection, isolated child retries, saved
  pending/completed requests after restart, and interrupted-action continuation
  without replay passed. Stored final replies and tool states were also checked.
- Native group discussion: five alternating turns, transcript sharing, starting
  over, stopping, and continuing with the next model passed.
- Native video checks with a mock provider: starting-frame generation, two-model
  playback, restored jobs after restart, Files export, sharing, renaming, and
  deletion passed. Exported MP4 bytes matched the generated fixture.
- Native speech checks with a mock provider: voice/format/speed/instructions,
  playback in all five formats, saved audio after restart, Files export, sharing,
  renaming, and deletion passed. Exported WAV bytes matched the generated fixture.
- Native live transcription with a local WebSocket upstream: automatic/manual
  turns, mute, final-turn preservation, copy/clear, background shutdown, and
  permission recovery through iOS Settings passed.
- Native voice checks with local OpenAI and Gemini WebSocket upstreams: microphone
  capture, replies, mute, saved audio replay/pause, OpenAI continuation, background
  saving, transcript copy, restart restoration, rename, and deletion passed.
- Native Canvas checks: streamed generation, interactive state, JSON editing,
  invalid input/output recovery, templates, stopping, model restoration, reset,
  PNG/PDF Files export, and both share sheets passed. Exported files were opened
  and visually checked. WebKit also verified all four templates and bound input.
- Native Escape checks: complete wins and timeout runs, saving/replay, model
  restoration, turn stepping, scrubbing, sharing, pasted links, pause/background,
  reset during a pending turn, level selection, rankings, and error recovery passed.
- Native profile checks: public username opt-in, picture privacy, leaderboard
  membership/removal/rejoining, level progress, streaks, activity points, and
  persistence across restarts passed.
- Native appearance checks: light/dark persistence through restart and sign-out,
  system overrides, keyboard and Markdown colors, chat draft preservation, and
  interactive Canvas state across a system theme change passed.
- Native image checks with a mock provider: generation/editing, model comparison,
  settings, history after restart, Files export/import, sharing, renaming, and
  deletion passed. Exported PNG bytes matched the generated fixture.
  The iOS 26 Files picker needs the coordinate taps documented in the flows.
  Rerun the complete flows after later app changes.

For `e2e/projects.yaml`, place the sample document in the dedicated simulator's Files storage first:

```sh
pnpm exec tsx apps/mobile/e2e/prepare-projects.ts <simulator-device-id>
```

Before `e2e/profile.yaml`, run `pnpm exec tsx apps/mobile/e2e/prepare-profile.ts` with `LOUNGE_API_URL` set
to the isolated API to reset the seeded member's
public username and privacy controls. Run the fixture again afterward. The flow
checks opt-in, picture privacy, leaderboard removal/rejoining, points, and restart
persistence; run it after `e2e/escape.yaml` so earned Escape points exist.

Run appearance flows sequentially with the simulator's system appearance set
using `xcrun simctl ui <device-id> appearance light` or `dark`:

1. Light: `appearance.yaml`; then dark: `appearance-system.yaml`.
2. Light: `appearance-chat-light.yaml`; then dark: `appearance-chat-dark.yaml`.
3. Light: `appearance-canvas-light.yaml`; then dark: `appearance-canvas-dark.yaml`.

Do not relaunch between each pair: the second flow checks live state preservation.
Pause expired mock connectors before the chat flow so it can generate a reply.

Escape flows use `POST /mock/escape` on the isolated upstream with a JSON
`mode`: `win` for `escape.yaml`, `slow` for `escape-controls.yaml`, `wait` for
`escape-loss.yaml`, and `error` for `escape-errors.yaml`. Switch back to `win`
before running `escape-recovery.yaml` without resetting the app. Run
`escape-links.yaml` with `-e REPLAY_URL=<saved-winning-run-url>` after a winning
run; it verifies shared-link input and rejects links from other websites.

Additional chat flows cover controls, streaming, sources, and sharing in
`e2e/chat-*.yaml`. Run `e2e/images.yaml` before `e2e/chat-attachments.yaml`
to place its generated PNG in Files.

Run `workspace-offline.yaml` after `workspace-persistence.yaml` with the isolated
API stopped; restart it before `workspace-retry.yaml`. For
`workspace-unavailable.yaml`, mark the selected seeded project inactive and
restore its original status afterward, including when the flow fails.

The Markdown renderer patch supplies accessibility bounds alongside its
VoiceOver outlines so iOS automation can inspect rendered text.

The audio patch adapts iOS voice processing from upstream
[react-native-audio-api #1210](https://github.com/software-mansion/react-native-audio-api/pull/1210)
for 0.13.3. Voice calls enable echo cancellation before resolving the microphone
format. It also keeps the existing Worklets compatibility fix.

## Release metadata

`ios/Lounge/PrivacyInfo.xcprivacy` declares account-linked data used by the app.
Keep it aligned with the account API and saved-content features:

| Data                                    | Collection path                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Name, email, user ID                    | Account creation/sign-in, profile, session, and account communications          |
| Email/message content                   | Approved connector results saved with conversations                             |
| Photos/video, audio, other user content | Attachments, prompts, documents, generated media, and saved conversations/calls |
| Gameplay content                        | Saved Escape runs and replays                                                   |
| Product interaction                     | Model usage, activity points, and usage analytics                               |
| Other data                              | Session IP address, user agent, and security metadata                           |
| Performance and diagnostics             | Request duration, time to first token, and error details                        |

These entries are linked to the account and are not used for tracking. Account
names/emails also cover the service's marketing communications. Identifiers,
product interactions, and request diagnostics cover analytics. Payments stay on
the website. Review the
[privacy policy](https://llmgateway.io/legal/privacy) and Apple's
[data-use definitions](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)
when changing collection or completing App Store Connect disclosures.

`Info.plist` sets `ITSAppUsesNonExemptEncryption` to `NO`: the app links only
standard-algorithm encryption (iOS TLS plus the OpenSSL bundled by the audio
dependency) and the beta is not distributed in France, so Apple requires no
export documentation. Revisit this before adding France or proprietary crypto.

## Delivery checklist

A checkbox requires observed behavior, not just a screen or passing type check.

- [x] Sign-in, secure session restoration, sign-out, signup/reset, account deletion
- [ ] Chat: streaming, model selection/favorites, search, reasoning, attachments, web search, stop/retry/edit/fork, settings
- [ ] History: synchronization, search, pin, archive, delete, public and organization sharing
- [x] Model comparison and group conversations
- [x] Projects: instructions, files, retrieval, memory, associated chats
- [x] Skills: create, edit, generate, enable, delete, apply in chat
- [x] Connectors: connect, authorize, use in conversations, disconnect
- [x] Image creation/editing, settings, multi-model comparison, history, save/share
- [ ] Video creation, input frames, polling, playback, history, save/share
- [x] Speech generation/transcription, playback, history
- [x] Realtime voice calls and call history
- [x] Canvas generation and interactive rendering
- [x] Escape gameplay and saved runs
- [x] Profile, points, levels, streaks, leaderboard
- [ ] Organization switching, membership/usage, web-only payments
- [ ] Accessibility, keyboard/safe-area handling, light/dark appearance
- [ ] Component/unit tests, isolated backend tests, complete iOS e2e flows
- [x] Production JavaScript bundle and signed simulator build
- [x] Signed device archive
- [ ] Recorded simulator demo
- [x] TestFlight upload under the requested account (1.0 build 1)
- [ ] TestFlight processing and export compliance confirmed in App Store Connect

Production configuration lives in `src/config.ts`. Do not publish credentials or
local test recordings containing personal accounts. Test against seeded local data.
