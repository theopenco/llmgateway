/**
 * Generic typed error for invalid client requests detected before we hit the
 * upstream provider (e.g. malformed message shapes). The gateway maps this to
 * the carried `statusCode` (default 400) and writes a client_error log row so
 * the rejected request still shows up in the user's activity history instead
 * of surfacing as a generic 500 with no log. Reuse this for any similar
 * pre-upstream request validation failure.
 */
export class RequestError extends Error {
	public readonly statusCode: number;
	public constructor(message: string, statusCode = 400) {
		super(message);
		this.name = "RequestError";
		this.statusCode = statusCode;
	}
}
