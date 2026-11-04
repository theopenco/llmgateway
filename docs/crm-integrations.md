# CRM integrations (Gmail, Calendly)

The admin CRM (`/crm` in `ee/admin`) reads and sends mail and lists booked
calls for an account without leaving the account page. Connections are made
once at `/crm/settings` and stored in `crm_integration`, sealed with the
connector cipher (`GATEWAY_API_KEY_HASH_SECRET` keyring). Mail sent from the
CRM and every Calendly event with an account contact land in the account's
activity feed (`crm_activity.external_ref` keeps them idempotent).

## Gmail

- OAuth client: `CRM_GOOGLE_CLIENT_ID` / `CRM_GOOGLE_CLIENT_SECRET`, falling
  back to `LOUNGE_GOOGLE_CLIENT_ID` / `LOUNGE_GOOGLE_CLIENT_SECRET`. The
  client needs `{API_URL}/admin/crm/integrations/gmail/callback` among its
  redirect URIs, the Gmail API enabled, and the `gmail.readonly` and
  `gmail.send` scopes on the consent screen. Both scopes are restricted, so
  keep the consent screen **Internal** (Workspace users only): no verification
  and no 100-user cap. Hosted uses the dedicated GCP project
  `llmgateway-crm` (Google Auth Platform → Clients → "LLM Gateway CRM
  (admin)"), not the Lounge connectors client.
- Connecting signs in as the mailbox itself. Gmail delegation is not exposed
  by the API, so a shared inbox such as `contact@` is connected by signing in
  as that account and ticking "Let teammates send from it".
- Every connected mailbox is searched for threads with the account's people
  (members, contact-form senders, billing address, hand-added contacts) and
  shown to all admins; sending needs the mailbox to be yours or shared.
- Replies keep the Gmail thread (`threadId`, `In-Reply-To`, `References`).

## Google Calendar and call briefings

- The Gmail connection also asks for `calendar.events.readonly`. Mailboxes
  connected before that scope existed show "mail only" on `/crm/settings` and
  need a reconnect.
- `/crm/calls` lists events from every connected primary calendar (next 7 to
  30 days) that have at least one attendee outside the mailbox's domain, each
  matched to a CRM account through its attendees (corporate domain, contact,
  member or lead email). Unmatched companies can be added as prospects from
  the briefing.
- A briefing (`/crm/calls/<integration>/<event>`) composes the account record,
  the attendees' contact and platform data, email threads with them and recent
  activity.

## AI research

- "Research company" / "Research person" on a briefing call
  `POST /admin/crm/research`, which runs a web-search-grounded prompt through
  the gateway (`tools: [{ type: "web_search" }]`) and stores the answer as a
  `note` activity titled `AI research: …` on the account, with the cited
  URLs appended.
- Config: `CRM_RESEARCH_GATEWAY_API_KEY` (a gateway API key on the company
  org; falls back to `SUPPORT_CHAT_API_KEY`) and `CRM_RESEARCH_MODEL`
  (default `openai/gpt-5.2`, any model with native web search).

## Calendly

- Each admin pastes a personal access token (Calendly → Integrations → API &
  webhooks). The CRM verifies it with `GET /users/me`, lists the user's active
  event types as booking links (prefilled with the contact's name and email),
  and lists `scheduled_events` filtered by each contact's email.
- On connect it tries to create a user-scoped webhook subscription for
  `invitee.created` / `invitee.canceled` pointing at
  `{API_URL}/public/crm-webhooks/calendly` with a random signing key. Webhooks
  need a paid Calendly plan; without one, meetings sync whenever an admin
  opens the account's Meetings tab.
- The webhook endpoint is unauthenticated and verifies the
  `Calendly-Webhook-Signature` header (`t=…,v1=…`, 5-minute replay window)
  against every stored signing key before touching the database. Invitees
  that match no CRM account are ignored.
