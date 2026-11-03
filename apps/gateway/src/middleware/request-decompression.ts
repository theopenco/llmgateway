import { promisify } from "node:util";
import {
	brotliDecompress,
	constants,
	gunzip,
	inflate,
	inflateRaw,
	zstdDecompress,
} from "node:zlib";

import { HTTPException } from "hono/http-exception";

import type { ServerTypes } from "@/vars.js";
import type { MiddlewareHandler } from "hono";

/** Size cap for both the encoded body and its decoded output (bomb guard). */
export const MAX_DECOMPRESSED_BODY_BYTES = 100 * 1024 * 1024;

function bodyTooLarge(): HTTPException {
	return new HTTPException(413, {
		message: `Request body exceeds ${MAX_DECOMPRESSED_BODY_BYTES} bytes`,
	});
}

async function readCappedBody(request: Request): Promise<Buffer> {
	if (!request.body) {
		return Buffer.alloc(0);
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return Buffer.concat(chunks, total);
		}
		total += value.byteLength;
		if (total > MAX_DECOMPRESSED_BODY_BYTES) {
			await reader.cancel();
			throw bodyTooLarge();
		}
		chunks.push(value);
	}
}

type Decoder = (
	input: Buffer,
	options: { maxOutputLength: number },
) => Promise<Buffer>;

const gunzipAsync: Decoder = promisify(gunzip);
const inflateAsync: Decoder = promisify(inflate);
const inflateRawAsync: Decoder = promisify(inflateRaw);

/** `deflate` should be zlib-wrapped (RFC 1950), but many clients send raw RFC 1951. */
const inflateAny: Decoder = async (input, options) => {
	try {
		return await inflateAsync(input, options);
	} catch (error) {
		if (
			error instanceof Error &&
			"errno" in error &&
			error.errno === constants.Z_DATA_ERROR
		) {
			return await inflateRawAsync(input, options);
		}
		throw error;
	}
};

const decoders = new Map<string, Decoder>([
	["gzip", gunzipAsync],
	["x-gzip", gunzipAsync],
	["deflate", inflateAny],
	["br", promisify(brotliDecompress)],
	["zstd", promisify(zstdDecompress)],
]);

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

	const unsupported = codings.filter((coding) => !decoders.has(coding));
	if (unsupported.length > 0) {
		throw new HTTPException(415, {
			message: `Unsupported Content-Encoding: ${unsupported.join(", ")}. Supported: ${[...decoders.keys()].join(", ")}`,
		});
	}

	const raw = c.req.raw;
	let body = await readCappedBody(raw);
	for (const coding of [...codings].reverse()) {
		const decode = decoders.get(coding)!;
		try {
			body = await decode(body, {
				maxOutputLength: MAX_DECOMPRESSED_BODY_BYTES,
			});
		} catch (error) {
			if (isOutputTooLarge(error)) {
				throw bodyTooLarge();
			}
			throw new HTTPException(400, {
				message: `Request body is not valid ${coding} data`,
			});
		}
	}

	const headers = new Headers(raw.headers);
	headers.delete("content-encoding");
	headers.delete("transfer-encoding");
	headers.set("content-length", String(body.byteLength));
	c.req.raw = new Request(raw.url, {
		method: raw.method,
		headers,
		body: new Uint8Array(body),
		signal: raw.signal,
	});
	return await next();
};
