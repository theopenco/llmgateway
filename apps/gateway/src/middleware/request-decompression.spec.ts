import { once } from "node:events";
import {
	brotliCompressSync,
	deflateSync,
	gzipSync,
	zstdCompressSync,
} from "node:zlib";

import { serve } from "@hono/node-server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import {
	MAX_DECOMPRESSED_BODY_BYTES,
	parseContentEncoding,
	requestDecompressionMiddleware,
} from "./request-decompression.js";

import type { AddressInfo } from "node:net";

const payload = {
	model: "test-model",
	messages: [{ role: "user", content: "héllo 🎉 ".repeat(500) }],
};
const json = Buffer.from(JSON.stringify(payload));

function createApp() {
	const app = new OpenAPIHono();
	app.use("*", requestDecompressionMiddleware);
	app.openapi(
		createRoute({
			method: "post",
			path: "/v1/chat/completions",
			request: {
				body: {
					content: {
						"application/json": {
							schema: z.object({
								model: z.string(),
								messages: z.array(z.any()),
							}),
						},
					},
				},
			},
			responses: { 200: { description: "ok" } },
		}),
		(c) =>
			c.json({
				body: c.req.valid("json"),
				contentEncoding: c.req.header("content-encoding") ?? null,
				contentLength: c.req.header("content-length") ?? null,
			}),
	);
	app.onError((error, c) =>
		c.json(
			{ message: error.message },
			error instanceof HTTPException ? error.status : 500,
		),
	);
	return app;
}

async function post(body: Uint8Array, contentEncoding?: string) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (contentEncoding !== undefined) {
		headers["content-encoding"] = contentEncoding;
	}
	return await createApp().request("/v1/chat/completions", {
		method: "POST",
		headers,
		body: new Uint8Array(body),
	});
}

describe("parseContentEncoding", () => {
	it("lists codings in application order without identity", () => {
		expect(parseContentEncoding(undefined)).toEqual([]);
		expect(parseContentEncoding("identity")).toEqual([]);
		expect(parseContentEncoding(" GZIP , identity, br")).toEqual([
			"gzip",
			"br",
		]);
	});
});

describe("requestDecompressionMiddleware", () => {
	it.each([
		["gzip", gzipSync(json)],
		["x-gzip", gzipSync(json)],
		["deflate", deflateSync(json)],
		["br", brotliCompressSync(json)],
		["zstd", zstdCompressSync(json)],
		["gzip, br", brotliCompressSync(gzipSync(json))],
	])("decodes a %s body before validation", async (coding, body) => {
		const res = await post(body, coding);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			body: payload,
			contentEncoding: null,
			contentLength: String(json.byteLength),
		});
	});

	it("decodes bodies served through @hono/node-server", async () => {
		const server = serve({ fetch: createApp().fetch, port: 0 });
		try {
			await once(server, "listening");
			const { port } = server.address() as AddressInfo;
			const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-encoding": "zstd",
				},
				body: new Uint8Array(zstdCompressSync(json)),
			});
			expect(res.status).toBe(200);
			expect((await res.json()).body).toEqual(payload);
		} finally {
			server.close();
		}
	});

	it("passes uncompressed and identity bodies through", async () => {
		for (const coding of [undefined, "identity"]) {
			const res = await post(json, coding);
			expect(res.status).toBe(200);
			expect((await res.json()).body).toEqual(payload);
		}
	});

	it("rejects an unsupported coding with 415", async () => {
		const res = await post(json, "compress");
		expect(res.status).toBe(415);
		expect((await res.json()).message).toContain(
			"Unsupported Content-Encoding: compress",
		);
	});

	it("rejects a body that does not match its coding with 400", async () => {
		const res = await post(json, "gzip");
		expect(res.status).toBe(400);
		expect((await res.json()).message).toBe(
			"Request body is not valid gzip data",
		);
	});

	it("rejects a body that decompresses past the size cap with 413", async () => {
		const bomb = gzipSync(Buffer.alloc(MAX_DECOMPRESSED_BODY_BYTES + 1));
		const res = await post(bomb, "gzip");
		expect(res.status).toBe(413);
	});
});
