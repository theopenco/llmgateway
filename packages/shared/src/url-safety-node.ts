/**
 * Node-only SSRF guard for tenant-supplied provider base URLs. Layers DNS
 * resolution on top of the browser-safe `assertSafeProviderBaseUrl` so a
 * hostname that resolves to a private/reserved address (including DNS
 * rebinding) is rejected before the outbound `fetch()`. Kept in a separate
 * entrypoint because it imports `node:dns` and must not leak into the browser
 * barrel.
 */
import { lookup } from "node:dns/promises";

import {
	assertSafeProviderBaseUrl,
	isPrivateOrReservedIp,
} from "./url-safety.js";

/**
 * Whether tenant-supplied provider base URLs must be SSRF-validated. Enabled on
 * the hosted multi-tenant deployment; self-hosted single-tenant installs may
 * legitimately point providers at internal/local model servers.
 */
export function isProviderUrlGuardEnabled(): boolean {
	return process.env.HOSTED === "true";
}

/**
 * Validate a provider `baseUrl` is safe to use as an outbound `fetch()` target:
 * http(s), not an internal host/IP literal, and whose hostname does not resolve
 * to a private/reserved address. No-op unless the provider URL guard is enabled
 * (see `isProviderUrlGuardEnabled`). Throws `Error` on an unsafe target.
 */
export async function assertSafeProviderUrl(rawUrl: string): Promise<void> {
	if (!isProviderUrlGuardEnabled()) {
		return;
	}

	const url = assertSafeProviderBaseUrl(rawUrl);

	const resolved = await lookup(url.hostname, { all: true });
	for (const { address } of resolved) {
		if (isPrivateOrReservedIp(address)) {
			throw new Error(
				`Provider base URL host ${url.hostname} resolves to a disallowed address (${address})`,
			);
		}
	}
}
