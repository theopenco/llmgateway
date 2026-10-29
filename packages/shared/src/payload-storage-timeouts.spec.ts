import { Agent, createServer, type RequestListener } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { zstdCompressSync } from "node:zlib";

import { expect, test, vi } from "vitest";

import { getLogPayload, getPayloadStorageClient } from "./payload-storage.js";

import type { Socket } from "node:net";

async function withObjectStore(
	handler: RequestListener,
	run: () => Promise<void>,
): Promise<void> {
	const env = { ...process.env };
	const sockets = new Set<Socket>();
	const server = createServer(handler);
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected a TCP listener");
	}
	Object.assign(process.env, {
		PAYLOAD_STORAGE_S3_BUCKET: "test-payloads",
		PAYLOAD_STORAGE_S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
		PAYLOAD_STORAGE_S3_REGION: "us-east-1",
		PAYLOAD_STORAGE_S3_ACCESS_KEY_ID: "fixture",
		PAYLOAD_STORAGE_S3_SECRET_ACCESS_KEY: "fixture",
		PAYLOAD_STORAGE_S3_FORCE_PATH_STYLE: "true",
	});
	try {
		await run();
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in env)) {
				Reflect.deleteProperty(process.env, key);
			}
		}
		Object.assign(process.env, env);
		sockets.forEach((socket) => socket.destroy());
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
}

async function expectDeadlineAndClose(handler: RequestListener): Promise<void> {
	let closed: Promise<void> | undefined;
	let requests = 0;
	await withObjectStore(
		(req, res) => {
			requests++;
			closed = new Promise<void>((resolve) => res.once("close", resolve));
			handler(req, res);
		},
		async () => {
			const startedAt = Date.now();
			await expect(
				getLogPayload("logs/org/project/log.json.zst", 500),
			).rejects.toThrow();
			expect(Date.now() - startedAt).toBeLessThan(3_000);
			expect(requests).toBe(1);
			expect(closed).toBeDefined();
			await closed;
		},
	);
}

test("deadline aborts before response headers and closes the socket", async () => {
	await expectDeadlineAndClose(() => {});
});

test("deadline aborts a continuously trickling body and closes the socket", async () => {
	await expectDeadlineAndClose((_req, res) => {
		res.writeHead(200, { "content-type": "application/zstd" });
		res.write("x");
		const timer = setInterval(() => res.write("x"), 40);
		res.once("close", () => clearInterval(timer));
	});
});

test("one deadline bounds retry backoff and retried requests", async () => {
	let requests = 0;
	let active = 0;
	await withObjectStore(
		(_req, res) => {
			requests++;
			active++;
			res.once("close", () => active--);
			if (requests === 1) {
				res.writeHead(503, { "content-type": "application/xml" });
				res.end("<Error><Code>ServiceUnavailable</Code></Error>");
			}
		},
		async () => {
			const startedAt = Date.now();
			await expect(getLogPayload("retry.json.zst", 500)).rejects.toThrow();
			expect(Date.now() - startedAt).toBeLessThan(3_000);
			expect(requests).toBe(2);
			await expect.poll(() => active).toBe(0);
		},
	);
});

test("retries a transient error and still reads the full payload", async () => {
	let requests = 0;
	const payload = { content: "retried payload" };
	await withObjectStore(
		(_req, res) => {
			if (++requests === 1) {
				res.writeHead(503, { "content-type": "application/xml" });
				res.end("<Error><Code>ServiceUnavailable</Code></Error>");
				return;
			}
			res.end(zstdCompressSync(Buffer.from(JSON.stringify(payload))));
		},
		async () => {
			expect(await getLogPayload("retry.json.zst", 5_000)).toEqual(payload);
			expect(requests).toBe(2);
		},
	);
});

test("a truncated body rejects instead of returning partial payload", async () => {
	let requests = 0;
	await withObjectStore(
		(_req, res) => {
			requests++;
			res.writeHead(200, { "content-length": "1024" });
			res.write("incomplete");
			res.socket?.end();
		},
		async () => {
			await expect(
				getLogPayload("truncated.json.zst", 1_000),
			).rejects.toThrow();
			expect(requests).toBe(1);
		},
	);
});

test("invalid compressed data rejects", async () => {
	await withObjectStore(
		(_req, res) => res.end("not zstd"),
		async () => {
			await expect(getLogPayload("invalid.json.zst", 1_000)).rejects.toThrow();
		},
	);
});

test("missing objects return null and preserve the SDK socket cap", async () => {
	await withObjectStore(
		(_req, res) => {
			res.writeHead(404, { "content-type": "application/xml" });
			res.end("<Error><Code>NoSuchKey</Code></Error>");
		},
		async () => {
			expect(await getLogPayload("missing.json.zst", 1_000)).toBeNull();
			const config = getSocketAgents();
			expect(config?.httpAgent).toBeInstanceOf(Agent);
			expect(config?.httpsAgent).toBeInstanceOf(HttpsAgent);
			expect(config?.httpAgent.maxSockets).toBe(50);
			expect(config?.httpsAgent.maxSockets).toBe(50);
		},
	);
});

test("large valid payloads are not truncated by the deadline", async () => {
	const payload = { content: "payload ".repeat(300_000) };
	await withObjectStore(
		(_req, res) => {
			res.end(zstdCompressSync(Buffer.from(JSON.stringify(payload))));
		},
		async () => {
			expect(await getLogPayload("large.json.zst", 5_000)).toEqual(payload);
		},
	);
});
function getSocketAgents(): { httpAgent: Agent; httpsAgent: HttpsAgent } {
	const handler = getPayloadStorageClient().config.requestHandler;
	if (
		!("httpHandlerConfigs" in handler) ||
		typeof handler.httpHandlerConfigs !== "function"
	) {
		throw new Error("Expected the SDK Node HTTP handler");
	}
	const { httpAgent, httpsAgent } = handler.httpHandlerConfigs() as Record<
		string,
		unknown
	>;
	if (!(httpAgent instanceof Agent) || !(httpsAgent instanceof HttpsAgent)) {
		throw new Error("Expected HTTP and HTTPS socket pools");
	}
	return { httpAgent, httpsAgent };
}

test("deadline interrupts a Retry-After backoff", async () => {
	let requests = 0;
	await withObjectStore(
		(_req, res) => {
			requests++;
			res.writeHead(503, {
				"content-type": "application/xml",
				"retry-after": "3",
			});
			res.end("<Error><Code>ServiceUnavailable</Code></Error>");
		},
		async () => {
			const startedAt = Date.now();
			const send = vi.spyOn(getPayloadStorageClient(), "send");
			try {
				await expect(getLogPayload("backoff.json.zst", 500)).rejects.toThrow();
				expect(Date.now() - startedAt).toBeLessThan(1_500);
				await expect(send.mock.results[0].value).rejects.toThrow();
				expect(requests).toBe(1);
			} finally {
				send.mockRestore();
			}
		},
	);
});
