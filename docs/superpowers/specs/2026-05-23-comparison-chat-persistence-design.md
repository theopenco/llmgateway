# Comparison Chat Persistence Design

**Date:** 2026-05-23
**Branch:** fix/chat-comparison-mode
**Status:** Approved, pending implementation

## Problem

When a user starts a playground chat in comparison mode (multiple model panels side by side), the extra panel messages are ephemeral — stored only in React state. Refreshing the page or navigating away loses all comparison panel history. The primary panel's messages are persisted, but the extra panels' are not. Users should be able to return to a comparison chat and continue the conversation across all panels.

## Approach: `parentChatId` on the chat table

Each extra comparison panel gets its own chat record in the database, linked to the primary chat via a `parentChatId` foreign key. This reuses all existing chat infrastructure (create, add message, load) with minimal new logic.

---

## Section 1: Data Model

### Schema change

One new nullable column on the `chat` table:

```sql
ALTER TABLE "chat" ADD COLUMN "parent_chat_id" text REFERENCES chat(id) ON DELETE CASCADE;
```

- `parentChatId` is `null` for all primary/normal chats
- Extra comparison panels set `parentChatId = primaryChatId` when their chat is created
- `ON DELETE CASCADE` ensures comparison child chats are deleted when the primary is deleted
- Added to Drizzle schema as `parentChatId: text().references(() => chat.id, { onDelete: "cascade" })`

### API changes

**`POST /chats` body:**
- Add optional `parentChatId?: string` field to `createChatSchema`
- Saved directly to the DB on insert

**`GET /chats/{id}` response:**
- Add `comparisonChatIds: string[]` — server queries `SELECT id FROM chat WHERE parent_chat_id = $id ORDER BY created_at ASC` and appends to the response
- `comparisonChatIds` is added only to the single-get response schema (not to the shared `chatSchema` used by the list endpoint — adding it there would require N+1 child queries for every sidebar load)
- Add `comparisonChatIds` to the `Chat` frontend interface as an optional field (`string[] | undefined`) since it only appears on the single-get response

**`GET /chats` (sidebar list):**
- Add `WHERE parent_chat_id IS NULL` filter so child comparison chats never appear in the sidebar as independent entries

---

## Section 2: ExtraChatPanel Refactor

ExtraChatPanel becomes chatId-aware, mirroring the primary panel's persistence logic in a slimmed-down form.

### New props

| Prop | Type | Purpose |
|------|------|---------|
| `primaryChatId` | `string \| null` | Set as `parentChatId` when creating the comparison chat |
| `initialChatId` | `string \| null \| undefined` | Passed when restoring from history; panel initializes with this chatId |

### New internal state & refs

- `comparisonChatId: string | null` — React state tracking this panel's chatId
- `comparisonChatIdRef: RefObject<string | null>` — ref mirror so callbacks always see the current value (same dual pattern the primary uses with `chatIdRef`)

### New hooks

- `useCreateChat()` — creates the child chat on first message
- `useAddMessage()` — saves user and assistant messages to DB
- `useDataChat(comparisonChatId ?? "")` — loads historical messages when `initialChatId` is provided

### `ensureComparisonChat(content: string): Promise<string>`

Mirrors the primary panel's `ensureCurrentChat`:

1. If `comparisonChatIdRef.current` exists, return it immediately
2. Otherwise call `createChat.mutateAsync({ body: { title: content.slice(0, 50), model: selectedModel, parentChatId: primaryChatId } })`
3. Store result in both `comparisonChatId` state and `comparisonChatIdRef`
4. Return the new chatId

### `submitFromPrimary` changes

Before calling `sendMessageWithHeaders`:

1. Call `ensureComparisonChat(content)` to get/create the chatId
2. Call `addMessage.mutateAsync` with `role: "user"` and the content — get back a saved message ID
3. Pass the saved message ID into `sendMessageWithHeaders` as the message ID (keeps ID stable between optimistic and persisted state)

### Assistant message saving

Add an `onFinish` callback to ExtraChatPanel's `useChat` hook. On stream completion:

1. Read `comparisonChatIdRef.current` for the chatId
2. Extract `content`, `reasoning`, `tools`, `metadata` from `message.parts` — identical extraction logic to the primary panel's `onFinish`
3. Call `addMessage.mutateAsync({ role: "assistant", content, reasoning, tools, metadata })`

### History restoration

When `initialChatId` is provided:

- `comparisonChatId` state and `comparisonChatIdRef` are initialized with `initialChatId` on mount
- A `useEffect` watches `useDataChat(comparisonChatId)` and calls `setMessages` when data loads — same pattern the primary panel uses

---

## Section 3: Parent Wiring (chat-page-client.tsx)

### Load effect changes

The existing `useEffect` that restores `model`, `webSearch`, and `comparisonEnabled` from `currentChatData` is extended:

- When `comparisonEnabled` is `true` and `currentChatData.chat.comparisonChatIds` is non-empty, set `extraPanelIds` to match the count of children
- Store the `comparisonChatIds` array in state so they can be passed as `initialChatId` to each `ExtraChatPanel`
- Panel order is stable because children are ordered by `createdAt ASC`

### New state

```ts
const [comparisonChatIds, setComparisonChatIds] = useState<string[]>([]);
```

Set during the load effect when restoring a comparison chat from history. Reset to `[]` on new chat.

### ExtraChatPanel props additions

Each rendered `ExtraChatPanel` receives:

```tsx
<ExtraChatPanel
  primaryChatId={currentChatId}
  initialChatId={comparisonChatIds[panelIndex] ?? null}
  ...existingProps
/>
```

### Panel keying

Currently panels are keyed by a numeric counter (`panelId`). With persistence, panels restored from history should be keyed by their `comparisonChatId` so React doesn't remount them. Strategy:

- Restored panels: keyed by `comparisonChatIds[i]`
- New panels added during an active session: keyed by the existing numeric counter until a chatId is assigned

### New chat flow

No change. Extra panels start with `initialChatId = null`, create their chats on first message. `comparisonChatIds` state stays `[]` until the page is reloaded and the chat is fetched from the DB.

### Sidebar filtering

The `GET /chats` list query adds `AND parent_chat_id IS NULL` to the existing `WHERE` clause so comparison child chats are invisible in the sidebar.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `parentChatId` nullable FK column to `chat` table |
| `packages/db/migrations/` | Generate migration via `drizzle-kit generate` |
| `apps/api/src/routes/chats.ts` | `createChatSchema` + `chatSchema` + insert + list filter + get response |
| `apps/api/openapi.json` | Regenerate via `generate-openapi.ts` |
| `apps/playground/src/lib/api/v1.d.ts` | Regenerate via `openapi-typescript` |
| `apps/playground/src/hooks/useChats.ts` | Add `comparisonChatIds` to `Chat` interface |
| `apps/playground/src/components/playground/chat-page-client.tsx` | Parent wiring: load effect, new state, props to ExtraChatPanel; ExtraChatPanel refactor |

---

## Out of Scope

- Persisting which model each extra panel uses across sessions (already handled — model is stored per chat record)
- Showing comparison child chats anywhere in the UI as standalone entries
- Editing user messages in comparison panels (follow existing primary panel edit flow separately)
- Syncing edits across panels (e.g. editing a user message in panel 1 does not affect panel 2)
