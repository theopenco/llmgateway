import { HTTPException } from "hono/http-exception";

export function videoRangeHeaders(headers: Headers): Record<string, string> {
	const range = headers.get("range");
	if (!range) {
		return {};
	}
	const ifRange = headers.get("if-range");
	return { Range: range, ...(ifRange && { "If-Range": ifRange }) };
}

export function videoProxyResponse(
	upstream: Response,
	contentType?: string | null,
) {
	if (upstream.status !== 416 && (!upstream.ok || !upstream.body)) {
		throw new HTTPException(502, {
			message: "Failed to fetch video content from upstream provider",
		});
	}
	const headers = new Headers();
	for (const name of [
		"Content-Length",
		"Content-Range",
		"Accept-Ranges",
		"ETag",
		"Last-Modified",
	]) {
		const value = upstream.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}
	headers.set(
		"Content-Type",
		upstream.headers.get("Content-Type") ?? contentType ?? "video/mp4",
	);
	return new Response(upstream.body, { status: upstream.status, headers });
}

export function inlineVideoResponse(
	bytes: Uint8Array<ArrayBuffer>,
	contentType: string,
	requestHeaders: Headers,
) {
	const headers = new Headers({
		"Content-Type": contentType,
		"Accept-Ranges": "bytes",
	});
	// Inline content has no validator to satisfy If-Range, so send the full file.
	const range = requestHeaders.has("if-range")
		? null
		: requestHeaders.get("range");
	if (!range) {
		headers.set("Content-Length", String(bytes.length));
		return new Response(bytes, { headers });
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(range);
	const suffix = !match?.[1];
	const start = suffix
		? Math.max(0, bytes.length - Number(match?.[2]))
		: Number(match?.[1]);
	const end =
		suffix || !match?.[2]
			? bytes.length - 1
			: Math.min(Number(match[2]), bytes.length - 1);
	if (
		!match ||
		(!match[1] && !match[2]) ||
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start > end ||
		start >= bytes.length
	) {
		headers.set("Content-Range", `bytes */${bytes.length}`);
		return new Response(null, { status: 416, headers });
	}
	headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
	headers.set("Content-Length", String(end - start + 1));
	return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
