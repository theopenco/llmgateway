import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate, zstdDecompress } from "node:zlib";

import { HTTPException } from "hono/http-exception";

import type { ServerTypes } from "@/vars.js";
import type { MiddlewareHandler } from "hono";

/** Decompression bomb guard: decoded bodies above this size are rejected. */
export const MAX_DECOMPRESSED_BODY_BYTES = 100 * 1024 * 1024;

type Decoder = (
	input: Buffer,
	options: { maxOutputLength: number },
) => Promise<Buffer>;

const gunzipAsync: Decoder = promisify(gunzip);

const decoders: Record<string, Decoder> = {
	gzip: gunzipAsync,
	"x-gzip": gunzipAsync,
	deflate: promisify(inflate),
	br: promisify(brotliDecompress),
	zstd: promisify(zstdDecompress),
};

/** Content codings in the order they were applied, `identity` dropped. */
export function parseContentEncoding(header: string | undefined): string[] {
	if (!header) {
		return [];
	}
	return header
		.split(",")
		.map((coding) => coding.trim().toLowerCase())
		.filter((coding) => coding !== "" && coding !== "identity");
}

function isOutputTooLarge(error: unknown): boolean {
	return (
		error instanceof RangeError &&
		"code" in error &&
		error.code === "ERR_BUFFER_TOO_LARGE"
	);
}

/**
 * Decodes a `Content-Encoding` request body (gzip, deflate, br, zstd) and
 * swaps in a plain request, so validators and handlers always see the
 * original JSON. Clients such as Empryo probe zstd/gzip first and fall back
 * on a 400/415; without decoding they saw "Malformed JSON in request body".
 */
export const requestDecompressionMiddleware: MiddlewareHandler<
	ServerTypes
> = async (c, next) => {
	if (c.req.method === "GET" || c.req.method === "HEAD") {
		return await next();
	}
	const codings = parseContentEncoding(c.req.header("content-encoding"));
	if (codings.length === 0) {
		return await next();
	}

	const unsupported = codings.filter((coding) => !(coding in decoders));
	if (unsupported.length > 0) {
		throw new HTTPException(415, {
			message: `Unsupported Content-Encoding: ${unsupported.join(", ")}. Supported: ${Object.keys(decoders).join(", ")}`,
		});
	}

	const raw = c.req.raw;
	let body: Buffer = Buffer.from(await raw.arrayBuffer());
	for (const coding of [...codings].reverse()) {
		try {
			body = await decoders[coding](body, {
				maxOutputLength: MAX_DECOMPRESSED_BODY_BYTES,
			});
		} catch (error) {
			if (isOutputTooLarge(error)) {
				throw new HTTPException(413, {
					message: `Decompressed request body exceeds ${MAX_DECOMPRESSED_BODY_BYTES} bytes`,
				});
			}
			throw new HTTPException(400, {
				message: `Request body is not valid ${coding} data`,
			});
		}
	}

	const headers = new Headers(raw.headers);
	headers.delete("content-encoding");
	headers.set("content-length", String(body.byteLength));
	c.req.raw = new Request(raw.url, {
		method: raw.method,
		headers,
		body: new Uint8Array(body),
		signal: raw.signal,
	});
	return await next();
};
