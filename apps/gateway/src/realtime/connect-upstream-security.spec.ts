import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";

import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { WebSocketServer } from "ws";

import { assertSafeResolvedUserUrl } from "@llmgateway/shared/url-safety-node";

import { connectUpstream } from "./connect-upstream.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { Server, Socket } from "node:net";
import type { WebSocket } from "ws";

beforeEach(() => {
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
});

const servers: Array<Server | WebSocketServer> = [];
const sockets: Socket[] = [];
const opened: WebSocket[] = [];

function preflight(baseUrl: string): RealtimePreflightResult {
	return {
		match: {
			modelId: "gpt-realtime",
			modelDef: { id: "gpt-realtime" },
			mapping: { providerId: "azure", externalId: "gpt-realtime" },
		},
		providerKey: { baseUrl, options: {} },
		upstreamToken: "local-fixture",
		configIndex: 0,
		usedMode: "api-keys",
	} as unknown as RealtimePreflightResult;
}

async function attempt(baseUrl: string) {
	try {
		const socket = await connectUpstream(preflight(baseUrl));
		opened.push(socket);
		return null;
	} catch (error) {
		return error;
	}
}

async function privateTcpServer() {
	let connections = 0;
	const server = createServer((socket) => {
		connections++;
		sockets.push(socket);
		socket.destroy();
	});
	servers.push(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing fixture port");
	}
	return { port: address.port, connections: () => connections };
}

function resolveToLoopback(defer = false) {
	const original = dns.lookup;
	let complete: (() => void) | undefined;
	vi.spyOn(dns, "lookup").mockImplementation(((
		hostname: string,
		options: dns.LookupOptions,
		callback: (
			error: NodeJS.ErrnoException | null,
			address: string | dns.LookupAddress[],
			family?: number,
		) => void,
	) => {
		if (hostname !== "fixture-public.example.com") {
			return Reflect.apply(original, dns, [hostname, options, callback]);
		}
		const resolve = () =>
			callback(
				null,
				options.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1",
				4,
			);
		if (defer) {
			complete = resolve;
		} else {
			queueMicrotask(resolve);
		}
	}) as typeof dns.lookup);
	syncBuiltinESMExports();
	return () => complete?.();
}

afterEach(async () => {
	vi.useRealTimers();
	for (const socket of opened.splice(0)) {
		socket.terminate();
	}
	for (const socket of sockets.splice(0)) {
		socket.destroy();
	}
	for (const server of servers.splice(0)) {
		if (server instanceof WebSocketServer) {
			for (const socket of server.clients) {
				socket.terminate();
			}
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	syncBuiltinESMExports();
});

describe("tenant realtime connection safety", () => {
	test("rejects HTTP before contacting a private WebSocket server", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		servers.push(server);
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing fixture port");
		}
		const error = await attempt(`http://127.0.0.1:${address.port}`);
		expect(error).toMatchObject({ status: 400, code: "invalid_base_url" });
		expect(server.clients.size).toBe(0);
	});

	test("rejects a private HTTPS address by default", async () => {
		const target = await privateTcpServer();
		expect(await attempt(`https://127.0.0.1:${target.port}`)).toMatchObject({
			status: 400,
			code: "invalid_base_url",
		});
		expect(target.connections()).toBe(0);
	});

	test("blocks DNS rebinding at socket lookup after creation-time public validation", async () => {
		const target = await privateTcpServer();
		const url = `https://fixture-public.example.com:${target.port}`;
		vi.spyOn(dnsPromises, "lookup").mockImplementation((async () => [
			{ address: "93.184.216.34", family: 4 },
		]) as unknown as typeof dnsPromises.lookup);
		resolveToLoopback();
		await expect(assertSafeResolvedUserUrl(url)).resolves.toBeInstanceOf(URL);
		expect(await attempt(url)).toMatchObject({
			status: 400,
			code: "invalid_base_url",
		});
		expect(target.connections()).toBe(0);
	});

	test("rejects credentials in a tenant URL without contacting its host", async () => {
		const target = await privateTcpServer();
		resolveToLoopback();
		expect(
			await attempt(
				`https://fixture:fixture@fixture-public.example.com:${target.port}`,
			),
		).toMatchObject({ status: 400, code: "invalid_base_url" });
		expect(target.connections()).toBe(0);
	});

	test("preserves explicitly trusted environment mock endpoints", async () => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		servers.push(server);
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing fixture port");
		}
		vi.stubEnv("LLM_AZURE_BASE_URL", `http://127.0.0.1:${address.port}`);
		const socket = await connectUpstream({
			...preflight(""),
			providerKey: undefined,
			usedMode: "credits",
		});
		opened.push(socket);
		expect(socket.readyState).toBe(1);
	});
});
async function stalledTenantDns() {
	const target = await privateTcpServer();
	const release = resolveToLoopback(true);
	vi.stubEnv("REALTIME_UPSTREAM_HANDSHAKE_TIMEOUT_MS", "25");
	expect(
		await attempt("https://fixture-public.example.com:" + target.port),
	).toMatchObject({ status: 504, code: "upstream_connect_timeout" });
	expect(dns.lookup).toHaveBeenCalledWith(
		"fixture-public.example.com",
		expect.anything(),
		expect.any(Function),
	);
	release();
	await Promise.resolve();
	expect(target.connections()).toBe(0);
}
async function providerRedirect() {
	const destination = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	servers.push(destination);
	await once(destination, "listening");
	const address = destination.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing fixture port");
	}
	const redirect = createHttpServer((_request, response) => {
		response.writeHead(302, { Location: "ws://127.0.0.1:" + address.port });
		response.end();
	});
	servers.push(redirect);
	redirect.listen(0, "127.0.0.1");
	await once(redirect, "listening");
	const origin = redirect.address();
	if (!origin || typeof origin === "string") {
		throw new Error("Missing fixture port");
	}
	vi.stubEnv("LLM_AZURE_BASE_URL", "http://127.0.0.1:" + origin.port);
	await expect(
		connectUpstream({
			...preflight(""),
			providerKey: undefined,
			usedMode: "credits",
		}),
	).rejects.toMatchObject({ status: 502, code: "upstream_connect_failed" });
	expect(destination.clients.size).toBe(0);
}

test(
	"bounds stalled tenant DNS and ignores a late private result",
	stalledTenantDns,
);
test("does not follow provider redirects", providerRedirect);
async function explicitProviderOptOut() {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	servers.push(server);
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Missing fixture port");
	}
	vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
	const socket = await connectUpstream(
		preflight("http://127.0.0.1:" + address.port),
	);
	opened.push(socket);
	expect(socket.readyState).toBe(1);
}

test(
	"honors the deployment-owned insecure-provider opt-out",
	explicitProviderOptOut,
);
