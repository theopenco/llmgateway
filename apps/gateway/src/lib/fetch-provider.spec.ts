import { createServer } from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { fetchProvider } from "./fetch-provider.js";
import { closeUpstreamDispatcher } from "./upstream-dispatcher.js";

import type { Server } from "node:http";

describe("fetchProvider tenant base URLs", () => {
	let server: Server;
	let url: string;
	let hits = 0;

	beforeAll(async () => {
		server = createServer((_req, res) => {
			hits++;
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("server has no port");
		}
		url = `http://localhost:${address.port}/v1/chat/completions`;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		hits = 0;
	});

	afterAll(async () => {
		await closeUpstreamDispatcher();
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	});

	it("refuses to connect when a tenant host resolves to a private address", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");

		await expect(
			fetchProvider(url, { method: "POST" }, "https://tenant.example"),
		).rejects.toThrow();
		expect(hits).toBe(0);
	});

	it("leaves operator-configured endpoints on the shared dispatcher", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");

		const res = await fetchProvider(url, { method: "POST" });

		expect(res.status).toBe(200);
		expect(hits).toBe(1);
	});

	it("skips the check when the provider URL guard is disabled", async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");

		const res = await fetchProvider(
			url,
			{ method: "POST" },
			"http://localhost",
		);

		expect(res.status).toBe(200);
		expect(hits).toBe(1);
	});
});
