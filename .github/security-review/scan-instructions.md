LLM Gateway is a multi-tenant proxy for LLM provider APIs. The highest-impact
failures, in order:

1. Data crossing organizations: any query on API, gateway or worker code paths
   that is not scoped by the caller's organization or project, or that trusts a
   client-supplied organization/project id without checking membership.
2. Provider keys and user API keys: logging them, returning them in responses,
   comparing them without the HMAC helpers in `@llmgateway/shared/api-key-hash`,
   or leaking a BYOK key through an error message.
3. Billing: anything that lets a caller spend credits they do not have, skip a
   charge, double a refund, or replay a Stripe/provider webhook. Money math
   that is not `Decimal` from `decimal.js`.
4. Server-side request forgery: user-supplied URLs (custom providers, MCP
   endpoints, webhooks, images) fetched with a bare `fetch()` instead of
   `processImageUrl` or `assertSafeUserContentUrl` from
   `@llmgateway/shared/url-safety-node`; private-network and metadata-endpoint
   reachability.
5. Authorization on admin and enterprise routes (`ee/`), including internal
   routes that trust a header set by a trusted proxy.
6. GitHub Actions: workflows on `pull_request_target` or `issue_comment` that
   check out or run PR code with a write token; unpinned third-party actions.

Report a finding only with a file and line and a concrete request or sequence
that triggers it.
