/**
 * Node-only SSRF guards for tenant-supplied outbound `fetch()` targets (provider
 * base URLs and user-supplied content URLs). Layers DNS resolution on top of the
 * browser-safe validators so a hostname that resolves to a private/reserved
 * address is also rejected. Kept in a separate entrypoint because it imports
 * `node:dns` and must not leak into the browser barrel.
 */
import { lookup as lookupCallback } from "node:dns";
import { lookup } from "node:dns/promises";

import { Agent, fetch as undiciFetch } from "undici";

import {
	assertSafeContentUrl,
	assertSafeProviderBaseUrl,
	assertSafeUserUrl,
	isPrivateOrReservedIp,
	isProviderUrlGuardEnabled,
} from "./url-safety.js";

import type { LookupAllOptions } from "node:dns";
import type { LookupFunction } from "node:net";

const safeUserUrlLookup: LookupFunction = (hostname, options, callback) => {
	const lookupOptions: LookupAllOptions = {
		...options,
		all: true,
	};

	lookupCallback(hostname, lookupOptions, (error, addresses) => {
		if (error) {
			callback(error, []);
			return;
		}

		const blockedAddress = addresses.find(({ address }) =>
			isPrivateOrReservedIp(address),
		);
		if (blockedAddress) {
			const lookupError = new Error(
				`User-provided URL host ${hostname} resolves to a disallowed address (${blockedAddress.address})`,
			) as NodeJS.ErrnoException;
			lookupError.code = "EACCES";
			callback(lookupError, []);
			return;
		}

		if (options.all) {
			callback(null, addresses);
			return;
		}

		const [address] = addresses;
		if (!address) {
			const lookupError = new Error(
				`User-provided URL host ${hostname} did not resolve`,
			) as NodeJS.ErrnoException;
			lookupError.code = "ENOTFOUND";
			callback(lookupError, []);
			return;
		}

		callback(null, address.address, address.family);
	});
};

let safeUserUrlAgent: Agent | undefined;

function getSafeUserUrlAgent(): Agent {
	safeUserUrlAgent ??= new Agent({
		connect: { lookup: safeUserUrlLookup },
	});
	return safeUserUrlAgent;
}

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

/** Validate a user-controlled outbound URL, including all current DNS results. */
export async function assertSafeResolvedUserUrl(rawUrl: string): Promise<URL> {
	const url = assertSafeUserUrl(rawUrl);
	await assertResolvedHostSafe(url.hostname, "User-provided URL");
	return url;
}

/**
 * Fetch a user-controlled URL without redirects. The custom DNS lookup rejects
 * unsafe addresses as part of socket creation, avoiding a validation/fetch DNS
 * race while preserving the original hostname for TLS verification.
 */
export async function fetchSafeUserUrl(
	input: string | URL,
	init?: RequestInit,
): Promise<Response> {
	const url = assertSafeUserUrl(input.toString());
	const requestInit = { ...init, redirect: "error" as const };

	return (await undiciFetch(url, {
		...requestInit,
		dispatcher: getSafeUserUrlAgent(),
	} as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

/**
 * Validate and fetch a user-supplied content URL (image/video/document URL in a
 * chat, image, or video request) in one step. Callers must handle `data:` URLs
 * themselves before calling this — it always performs a network fetch.
 *
 * Unlike a separate `assertSafeUserContentUrl()` + `fetch()`, the DNS lookup
 * used to validate the host is the same one pinned to the actual connection
 * (via the custom-lookup dispatcher), so a DNS record that changes between
 * validation and connect can't rebind the request onto a private/reserved
 * address. Redirects are refused. No-op passthrough to a plain fetch when the
 * guard is disabled via `ALLOW_INSECURE_PROVIDER_URLS` (see
 * `isProviderUrlGuardEnabled`), matching `assertSafeUserContentUrl`.
 */
export async function fetchSafeUserContentUrl(
	input: string,
	init?: RequestInit,
): Promise<Response> {
	const requestInit = { ...init, redirect: "error" as const };

	if (!isProviderUrlGuardEnabled()) {
		return await fetch(input, requestInit);
	}

	const url = assertSafeContentUrl(input);

	return (await undiciFetch(url, {
		...requestInit,
		dispatcher: getSafeUserUrlAgent(),
	} as Parameters<typeof undiciFetch>[1])) as unknown as Response;
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
