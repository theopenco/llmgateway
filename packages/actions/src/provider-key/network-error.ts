/**
 * A provider call that never produced an HTTP response: DNS, TCP, TLS or
 * timeout failures. `fetch` reports every one of them as the same opaque
 * `TypeError: fetch failed`, with the real reason buried in the `cause`
 * chain, so callers that surface the raw message tell the user nothing.
 */
export interface NetworkFailure {
	/** Node/undici error code, e.g. `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`. */
	code: string;
	/** Client-facing explanation of what could not be reached and why. */
	message: string;
	/** Underlying cause text, for logs only. */
	detail: string;
}

const MAX_CAUSE_DEPTH = 5;

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const REFUSED_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);
const TIMEOUT_CODES = new Set([
	"ETIMEDOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_BODY_TIMEOUT",
]);
const RESET_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);
const TLS_CODE_PREFIXES = [
	"CERT_",
	"ERR_TLS_",
	"DEPTH_ZERO_",
	"SELF_SIGNED_",
	"UNABLE_TO_",
];

/**
 * The error plus its `cause` chain. An `AggregateError` (undici raises one
 * when every resolved address fails to connect) hides the real code inside
 * `errors`, so descend into its first entry as if it were the cause.
 */
function unwrapCauses(error: unknown): Error[] {
	const chain: Error[] = [];
	let current: unknown = error;
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH && current instanceof Error;
		depth++
	) {
		chain.push(current);
		const aggregated = (current as AggregateError).errors;
		current =
			Array.isArray(aggregated) && aggregated.length > 0
				? aggregated[0]
				: (current as { cause?: unknown }).cause;
	}
	return chain;
}

function firstErrorCode(chain: Error[]): string | undefined {
	for (const error of chain) {
		const code = (error as NodeJS.ErrnoException).code;
		if (typeof code === "string" && code) {
			return code;
		}
	}
	return undefined;
}

/**
 * Host of the endpoint, never the full URL: Google AI Studio and Vertex in
 * api-key mode carry the credential in the query string, so anything beyond
 * the host would leak the token into error messages and logs.
 */
function endpointHost(endpoint: string | undefined): string | undefined {
	if (!endpoint) {
		return undefined;
	}
	try {
		return new URL(endpoint).host || undefined;
	} catch {
		return undefined;
	}
}

function isTlsCode(code: string): boolean {
	return TLS_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

/**
 * Classify a thrown provider-call error as a connectivity failure, or return
 * `undefined` when it is a genuine bug on our side (a missing model, a broken
 * payload) that deserves the usual error-level treatment.
 */
export function describeNetworkFailure(
	error: unknown,
	endpoint?: string,
): NetworkFailure | undefined {
	if (!(error instanceof Error)) {
		return undefined;
	}

	const chain = unwrapCauses(error);
	const code = firstErrorCode(chain);
	const isFetchFailure =
		error instanceof TypeError && /fetch failed/i.test(error.message);
	if (!isFetchFailure && !code) {
		return undefined;
	}

	const cause = chain[chain.length - 1];
	const detail =
		cause === error ? error.message : `${error.message}: ${cause.message}`;
	const target = endpointHost(endpoint) ?? "the provider endpoint";

	// `redirect: "error"` is deliberate (a tenant-supplied baseUrl must not be
	// able to bounce the probe, and the token, at an internal host), so say so
	// rather than reporting it as an unreachable host.
	if (!code && /redirect/i.test(cause.message)) {
		return {
			code: "UNEXPECTED_REDIRECT",
			message: `${target} answered with a redirect, which is not followed when validating a credential. Point the credential at the final URL instead.`,
			detail,
		};
	}

	if (code && DNS_CODES.has(code)) {
		return {
			code,
			message: `Could not resolve ${target} (DNS lookup failed: ${code}). Check the base URL / resource name configured for this credential.`,
			detail,
		};
	}

	if (code && REFUSED_CODES.has(code)) {
		return {
			code,
			message: `${target} refused the connection (${code}). Check the base URL / resource name configured for this credential.`,
			detail,
		};
	}

	if (code && TIMEOUT_CODES.has(code)) {
		return {
			code,
			message: `The connection to ${target} timed out (${code}).`,
			detail,
		};
	}

	if (code && RESET_CODES.has(code)) {
		return {
			code,
			message: `The connection to ${target} was closed before a response arrived (${code}).`,
			detail,
		};
	}

	if (code && isTlsCode(code)) {
		return {
			code,
			message: `The TLS handshake with ${target} failed (${code}).`,
			detail,
		};
	}

	return {
		code: code ?? "FETCH_FAILED",
		message: `Could not reach ${target}: ${cause.message}`,
		detail,
	};
}
