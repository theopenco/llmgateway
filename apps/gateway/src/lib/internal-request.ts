type InternalRequest = (path: string, init: RequestInit) => Promise<Response>;

let handler: InternalRequest | undefined;

/**
 * Lets request-path modules call the gateway in-process without importing
 * `app.ts`, which imports them back (an import cycle breaks route setup).
 */
export function setInternalRequestHandler(next: InternalRequest): void {
	handler = next;
}

export async function internalRequest(
	path: string,
	init: RequestInit,
): Promise<Response> {
	if (!handler) {
		throw new Error("Internal request handler is not registered");
	}
	return await handler(path, init);
}
