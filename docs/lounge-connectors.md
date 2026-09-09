# Lounge connectors

The API owns OAuth and encrypted connection credentials. The Lounge sends only
connector IDs with a chat. Tool schemas come from the provider; every invocation
requires a signed, user-scoped approval in chat. Connections belong to the user,
including when they switch organizations.

Set `API_URL` to the externally reachable API origin and `PLAYGROUND_URL` to the
Lounge origin. OAuth callbacks are
`{API_URL}/connectors/{connector-id}/callback`. Keep
`GATEWAY_API_KEY_HASH_SECRET` configured in the API and Lounge: it protects stored
credentials and signs tool approvals. Rotation uses the existing keyring.

| Connector                               | Setup                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostHog, Notion, Linear, Sentry, Stripe | OAuth client registration is discovered from each official MCP server.                                                                                                                                                                                                                                                                                  |
| Slack                                   | Set `LOUNGE_SLACK_CLIENT_ID` and `LOUNGE_SLACK_CLIENT_SECRET` for a published or internal Slack app approved for MCP.                                                                                                                                                                                                                                   |
| Figma                                   | Register an approved remote MCP client with Figma, then set `LOUNGE_FIGMA_CLIENT_ID` and `LOUNGE_FIGMA_CLIENT_SECRET`. Figma rejects unrestricted dynamic registration.                                                                                                                                                                                 |
| Gmail, Google Drive                     | Set `LOUNGE_GOOGLE_CLIENT_ID` and `LOUNGE_GOOGLE_CLIENT_SECRET`. Register both callbacks; enable Gmail and Drive APIs and configure the consent screen for `gmail.readonly` and `drive.readonly`. External production use requires Google's applicable scope verification.                                                                              |
| GitHub                                  | Set `LOUNGE_GITHUB_CLIENT_ID` and `LOUNGE_GITHUB_CLIENT_SECRET` for an OAuth app. Requests `repo read:org` and uses the official GitHub MCP endpoint.                                                                                                                                                                                                   |
| Shopify                                 | Set `LOUNGE_SHOPIFY_CLIENT_ID` and `LOUNGE_SHOPIFY_CLIENT_SECRET`. Configure a standalone app with `read_products,read_orders`. Users enter their `myshopify.com` domain; callbacks are HMAC-verified. Online tokens respect the authorizing staff member’s permissions and require reconnection when their Shopify session expires (at most 24 hours). |

Apps without required deployment configuration remain visible but cannot start
a connection. Connectors using provider MCP tools retain the provider's granted
permissions. Gmail and Drive tools read data; Shopify tools query products and
recent orders. Disconnect removes the Lounge's stored credentials and pending
authorizations. Users can also revoke the application in the provider's account
settings. Pausing retains the connection but blocks tool discovery and calls.

Tool results are sent to the selected model and saved with regular chat history.
Sharing a chat shares its recorded results, never its connector credentials.
Temporary chats do not save their results.

Run connector unit and integration coverage with `pnpm exec vitest run
apps/api/src/lib/connectors apps/api/src/routes/connectors.spec.ts
apps/playground/src/app/api/chat/route.spec.ts --no-file-parallelism` against the
isolated test database. Run Lounge browser coverage with
`PW_BASE_URL=http://localhost:3103 PW_API_URL=http://localhost:4102 pnpm --filter
playground test:e2e` after starting the isolated API and Lounge.

For a live SDK smoke test, start the isolated gateway with a configured upstream
key, then run `LOUNGE_E2E_GATEWAY_URL=http://localhost:4101 pnpm exec vitest run
-c vitest/vitest.e2e.config.mts apps/playground/src/lib/lounge-sdk.e2e.ts
--no-file-parallelism`. It uses the seeded `test-token` and makes billed upstream
requests. `LOUNGE_E2E_MODEL` selects a pinned provider/model.

References: [AI SDK MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools),
[AI SDK approvals](https://ai-sdk.dev/docs/agents/tool-approvals),
[Slack MCP](https://docs.slack.dev/ai/slack-mcp-server/),
[Figma scopes](https://developers.figma.com/docs/rest-api/scopes/),
[Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps),
[Shopify OAuth](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps).
