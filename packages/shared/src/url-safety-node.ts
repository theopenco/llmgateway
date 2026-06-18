/**
 * Node-only SSRF guard for tenant-supplied provider base URLs. Layers DNS
 * resolution on top of the browser-safe `assertSafeProviderBaseUrl` so a
 * hostname that resolves to a private/reserved address is rejected at
 * registration time. Kept in a separate entrypoint because it imports
 * `node:dns` and must not leak into the browser barrel.
 */
import { lookup } from "node:dns/promises";

import {
	assertSafeProviderBaseUrl,
	isPrivateOrReservedIp,
	isProviderUrlGuardEnabled,
} from "./url-safety.js";

/**
 * Validate a provider `baseUrl` is safe to store and later use as an outbound
 * `fetch()` target: https, not an internal host/IP literal, and whose hostname
 * does not resolve to a private/reserved address (incl. IPv4-mapped IPv6).
 * No-op when the guard is disabled via `ALLOW_INSECURE_PROVIDER_URLS` (see
 * `isProviderUrlGuardEnabled`). Throws `Error` on an unsafe target.
 *
 * Validation happens once, at provider-key registration. The gateway trusts the
 * stored value at request time, so providers must only ever be created through
 * this checked path.
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
