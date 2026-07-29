/**
 * Connection-phase failure surfaced before the WebSocket upgrade completes.
 * Rendered as a plain HTTP error response on the upgrade socket so callers get
 * a status code and JSON body instead of an opaque handshake failure.
 */
export class RealtimeConnectError extends Error {
	public readonly status: number;
	public readonly code: string;

	public constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "RealtimeConnectError";
		this.status = status;
		this.code = code;
	}
}
