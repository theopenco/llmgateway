# CRM integrations (Gmail, Google Calendar)

The admin CRM (`/crm` in `ee/admin`) reads and sends mail and lists
meetings for an account without leaving the account page. Connections are made
once at `/crm/settings` and stored in `crm_integration`, sealed with the
connector cipher (`GATEWAY_API_KEY_HASH_SECRET` keyring). Mail sent from the
CRM and every held meeting with an account contact land in the account's
activity feed (`crm_activity.external_ref` keeps them idempotent).

## Gmail

- OAuth client: `CRM_GOOGLE_CLIENT_ID` / `CRM_GOOGLE_CLIENT_SECRET` (no
  fallback to the Lounge client, which lacks the CRM callback). The client
  needs `{API_URL}/admin/crm/integrations/gmail/callback` among its
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
- The account's Meetings tab searches every connected calendar for events
  with the account's people (a year back to 90 days ahead) and mirrors held
  ones into the activity feed, keyed on the event's iCalUID.
- Calendly bookings need no separate integration: Calendly writes them into
  the host's Google calendar, so connect the host's mailbox. Events that
  appear on several connected calendars are shown once (same iCalUID).
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
