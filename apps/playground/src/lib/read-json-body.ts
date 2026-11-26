export type JsonBodyResult<T> =
	{ ok: true; body: T } | { ok: false; error: unknown };

// Starts reading the request body as soon as it is called so the download
// overlaps the auth round trip, and never rejects, so a handler can return
// early (e.g. 401) without awaiting it.
export function readJsonBody<T = unknown>(
	req: Request,
): Promise<JsonBodyResult<T>> {
	return req.json().then(
		(body: T) => ({ ok: true as const, body }),
		(error: unknown) => ({ ok: false as const, error }),
	);
}
