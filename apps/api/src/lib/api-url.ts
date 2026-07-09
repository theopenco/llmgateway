/**
 * Public base URL of the management API — the origin that serves the Better Auth
 * SAML endpoints (`/auth/sso/saml2/...`) and the SCIM 2.0 router (`/scim/v2`).
 * These URLs are handed to customers to paste into their IdP (Okta / Entra), so
 * they must be the publicly reachable host.
 *
 * Resolution order:
 *  1. An explicit `API_URL` (any deployment can override).
 *  2. On the hosted service (`HOSTED=true`), the production management-API
 *     domain, so hosted customers get correct URLs without extra config.
 *  3. Local development default.
 *
 * Self-hosters run with `HOSTED` unset, so they must set `API_URL` in
 * production — they never get the hosted default.
 */
export function getApiBaseUrl(): string {
	const configured = process.env.API_URL?.trim();
	if (configured) {
		return configured;
	}
	return process.env.HOSTED === "true"
		? "https://internal.llmgateway.io"
		: "http://localhost:4002";
}
