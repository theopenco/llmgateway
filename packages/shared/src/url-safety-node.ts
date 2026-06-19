/**
 * Node-only SSRF guards for tenant-supplied outbound `fetch()` targets (provider
 * base URLs and user-supplied content URLs). Layers DNS resolution on top of the
 * browser-safe validators so a hostname that resolves to a private/reserved
 * address is also rejected. Kept in a separate entrypoint because it imports
 * `node:dns` and must not leak into the browser barrel.
 */
import { lookup } from "node:dns/promises";

import {
	assertSafeContentUrl,
	assertSafeProviderBaseUrl,
	isPrivateOrReservedIp,
	isProviderUrlGuardEnabled,
} from "./url-safety.js";

/**
 * Resolve a hostname and throw if any returned address is private/reserved
 * (incl. IPv4-mapped IPv6). Shared by the provider and content URL guards.
 */
async function assertResolvedHostSafe(
	hostname: string,
	label: string,
): Promise<void> {
	const resolved = await lookup(hostname, { all: true });
	for (const { address } of resolved) {
		if (isPrivateOrReservedIp(address)) {
			throw new Error(
				`${label} host ${hostname} resolves to a disallowed address (${address})`,
			);
		}
	}
}

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

	await assertResolvedHostSafe(url.hostname, "Provider base URL");
}

/**
 * Validate a user-supplied content URL (image/video/document URL in a chat,
 * image, or video request) before the gateway fetches it server-side: https, not
 * an internal host/IP literal, and whose hostname does not resolve to a
 * private/reserved address. `data:` URLs are not network fetches and pass
 * through. No-op when the guard is disabled via `ALLOW_INSECURE_PROVIDER_URLS`
 * (which also relaxes outbound content fetches so self-hosted/local-test
 * deployments can reach http/localhost media). Throws `Error` on an unsafe
 * target.
 *
 * Unlike provider base URLs, content URLs are validated per request because they
 * arrive in the request body. Callers must still refuse redirects on the fetch
 * (`redirect: "error"`) so a validated host cannot 3xx onward to an internal one.
 */
export async function assertSafeUserContentUrl(rawUrl: string): Promise<void> {
	if (!isProviderUrlGuardEnabled()) {
		return;
	}

	if (rawUrl.startsWith("data:")) {
		return;
	}

	const url = assertSafeContentUrl(rawUrl);

	await assertResolvedHostSafe(url.hostname, "Content URL");
}
