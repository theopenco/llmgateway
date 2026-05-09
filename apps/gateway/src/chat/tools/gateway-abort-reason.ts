/**
 * Typed reason attached when the gateway aborts an upstream request via
 * `controller.abort(reason)`. AbortError on its own is ambiguous — undici can
 * surface upstream socket failures (HTTP/2 RST, ECONNRESET, etc.) as
 * AbortError, and a third-party fetch shim could in principle abort the
 * combined signal. Tagging our own aborts lets catch blocks distinguish "we
 * aborted because the downstream client disconnected" from "the runtime
 * raised AbortError for some other cause."
 *
 * Implemented as an Error subclass so:
 *   - `error instanceof Error` is true at every catch site (a plain object
 *     reason gets thrown bare by the WHATWG ReadableStream/fetch impls and
 *     bypasses the standard Error-shaped catch arms).
 *   - undici's internal `.stack` annotation doesn't blow up. A frozen plain
 *     object reason produced "Cannot define property stack, object is not
 *     extensible" TypeErrors that polluted logs as upstream_error.
 */
export class ClientDisconnectError extends Error {
	readonly type = "client_disconnect" as const;

	constructor() {
		super("client_disconnect");
		this.name = "ClientDisconnectError";
	}
}

export const CLIENT_DISCONNECT_REASON: ClientDisconnectError =
	new ClientDisconnectError();

export function isGatewayAbortReason(
	reason: unknown,
): reason is ClientDisconnectError {
	return (
		typeof reason === "object" &&
		reason !== null &&
		"type" in reason &&
		(reason as { type?: unknown }).type === "client_disconnect"
	);
}

/**
 * Recognize a self-initiated client disconnect from an upstream catch block.
 *
 * When `controller.abort(reason)` is called with a non-Error reason, both
 * `fetch()` and `ReadableStream.read()` reject with the reason itself rather
 * than wrapping it in an AbortError. We need to recognize both shapes:
 *   - `error` IS our gateway abort reason (non-Error path), or
 *   - `error` is an AbortError and `signal.reason` is our gateway abort reason.
 *
 * Without this, client cancels get mislabeled as `gateway_error` because the
 * generic streaming-error handler runs on the bare reason object.
 */
export function isSelfInitiatedClientDisconnect(
	error: unknown,
	signal: AbortSignal,
): boolean {
	if (isGatewayAbortReason(error)) {
		return true;
	}
	return (
		error instanceof Error &&
		error.name === "AbortError" &&
		isGatewayAbortReason(signal.reason)
	);
}
