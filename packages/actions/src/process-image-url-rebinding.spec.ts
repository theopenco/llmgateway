import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";

import { expect, test, vi } from "vitest";

import { processImageUrl } from "./process-image-url.js";

test("rejects a host that rebinds to loopback before opening the socket", async () => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
	let connections = 0;
	const server = createServer((socket) => {
		connections++;
		socket.destroy();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing test server address");
	}
	const originalLookup = dns.lookup;
	const originalPromiseLookup = dnsPromises.lookup;
	const host = "rebind.example.test";
	// Preflight sees a public address, but the socket lookup sees loopback.
	dnsPromises.lookup = vi
		.fn()
		.mockResolvedValue([
			{ address: "8.8.8.8", family: 4 },
		]) as typeof dnsPromises.lookup;
	Reflect.set(dns, "lookup", (...args: unknown[]) => {
		const [hostname, options, callback] = args;
		if (hostname !== host) {
			return Reflect.apply(originalLookup, dns, args);
		}
		if (typeof callback !== "function") {
			throw new Error("Missing DNS callback");
		}
		const all =
			typeof options === "object" &&
			options !== null &&
			"all" in options &&
			options.all;
		Reflect.apply(
			callback,
			undefined,
			all
				? [null, [{ address: "127.0.0.1", family: 4 }]]
				: [null, "127.0.0.1", 4],
		);
	});
	syncBuiltinESMExports();
	try {
		await expect(
			processImageUrl(
				`https://${host}:${address.port}/image.png`,
				true,
				20,
				null,
				AbortSignal.timeout(5000),
			),
		).rejects.toMatchObject({ statusCode: 400 });
		expect(connections).toBe(0);
	} finally {
		dns.lookup = originalLookup;
		dnsPromises.lookup = originalPromiseLookup;
		syncBuiltinESMExports();
		vi.unstubAllEnvs();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});
