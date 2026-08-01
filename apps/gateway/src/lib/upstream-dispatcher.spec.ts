import { createServer } from "node:http";

import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	closeUpstreamDispatcher,
	installUpstreamDispatcher,
} from "./upstream-dispatcher.js";

import type { Server } from "node:http";
import type { Dispatcher } from "undici";

describe("upstream dispatcher", () => {
	let originalDispatcher: Dispatcher;
	let server: Server;
	let baseUrl: string;
	const clientPorts: number[] = [];

	beforeAll(async () => {
		originalDispatcher = getGlobalDispatcher();
		server = createServer((req, res) => {
			clientPorts.push(req.socket.remotePort!);
			if (req.url === "/sse") {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write("data: first\n\n");
				// keep the stream open; a later write + end completes it
				setTimeout(() => {
					res.write("data: second\n\n");
					res.end();
				}, 200);
			} else {
				res.writeHead(200, { "content-type": "application/json" });
				res.end("{}");
			}
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (typeof address === "string" || !address) {
			throw new Error("expected a TCP address");
		}
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		await closeUpstreamDispatcher();
		setGlobalDispatcher(originalDispatcher);
		delete process.env.UPSTREAM_KEEPALIVE_TIMEOUT_MS;
		clientPorts.length = 0;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	it("reuses one keep-alive socket across sequential fetches", async () => {
		installUpstreamDispatcher();
		for (let i = 0; i < 3; i++) {
			const res = await fetch(`${baseUrl}/json`);
			await res.text();
			// give the pool a tick to release the socket back
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(clientPorts).toHaveLength(3);
		expect(new Set(clientPorts).size).toBe(1);
	});

	it("streams response bodies incrementally through the dispatcher", async () => {
		installUpstreamDispatcher();
		const res = await fetch(`${baseUrl}/sse`);
		const reader = res.body!.getReader();
		const start = Date.now();
		const first = await reader.read();
		const firstChunkMs = Date.now() - start;
		expect(new TextDecoder().decode(first.value)).toContain("data: first");
		// the first chunk must arrive well before the 200ms second write —
		// i.e. the dispatcher must not buffer the stream until completion
		expect(firstChunkMs).toBeLessThan(150);
		await reader.cancel();
	});

	it("falls back to defaults on invalid env values", () => {
		process.env.UPSTREAM_KEEPALIVE_TIMEOUT_MS = "not-a-number";
		expect(() => installUpstreamDispatcher()).not.toThrow();
	});
});
