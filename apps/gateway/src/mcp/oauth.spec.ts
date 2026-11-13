import { createHash, randomBytes } from "node:crypto";

import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { HonoRequest } from "hono/request";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getApiKeyHashSecret,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";

const API_KEY = "test-token";
const REDIRECT_URI = "http://127.0.0.1:53682/callback";

interface Registration {
	client_id: string;
	client_secret: string;
	redirect_uris: string[];
}
interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	error?: string;
}

function newPkce() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

async function register(): Promise<Registration> {
	const response = await app.request("/oauth/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			api_key: API_KEY,
			client_name: "test-client",
			redirect_uris: [REDIRECT_URI],
		}),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as Registration;
}

async function authorize(clientId: string, challenge?: string): Promise<URL> {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		state: "state-value",
	});
	if (challenge) {
		params.set("code_challenge", challenge);
		params.set("code_challenge_method", "S256");
	}
	const response = await app.request(`/oauth/authorize?${params}`);
	expect(response.status).toBe(302);
	return new URL(response.headers.get("location")!);
}

async function token(params: Record<string, string>) {
	const response = await app.request("/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params).toString(),
	});
	return {
		status: response.status,
		body: (await response.json()) as TokenResponse,
	};
}

async function callMcp(bearer: string): Promise<number> {
	const response = await app.request("/mcp", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bearer}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: LATEST_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "oauth-spec", version: "1.0.0" },
			},
		}),
	});
	await response.text();
	return response.status;
}

/** Drops cached rows but keeps the OAuth grants under test. */
async function clearCacheExceptOAuthState() {
	let cursor = "0";
	do {
		const [next, keys] = await redisClient.scan(cursor, "COUNT", 1000);
		cursor = next;
		const cached = keys.filter((key) => !key.startsWith("mcp-oauth:"));
		if (cached.length > 0) {
			await redisClient.unlink(...cached);
		}
	} while (cursor !== "0");
}

/** Registers, authorizes with PKCE and exchanges the code. */
async function completeFlow() {
	const client = await register();
	const { verifier, challenge } = newPkce();
	const code = (await authorize(client.client_id, challenge)).searchParams.get(
		"code",
	)!;
	const exchange = await token({
		grant_type: "authorization_code",
		code,
		code_verifier: verifier,
		redirect_uri: REDIRECT_URI,
		client_id: client.client_id,
		client_secret: client.client_secret,
	});
	expect(exchange.status).toBe(200);
	return { client, code, verifier, tokens: exchange.body };
}

describe("MCP OAuth", () => {
	createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "oauth-api-key",
			...hashApiKeyForStorage(API_KEY),
			projectId: "project-id",
			createdBy: "user-id",
			description: "OAuth regression key",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	test.each([
		"not-json",
		"",
		"{",
		"null",
		"[]",
		"true",
		'"string"',
		'{"client_name":123}',
		'{"api_key":{}}',
	])(
		"registration rejects invalid body %j without error logging",
		async (body) => {
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const response = await app.request("/oauth/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: "invalid_request",
				error_description: "Invalid request body",
			});
			expect(errorSpy).not.toHaveBeenCalled();
		},
	);

	test("registration does not disguise unexpected failures as client errors", async () => {
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		vi.spyOn(HonoRequest.prototype, "json").mockRejectedValueOnce(
			new Error("Request read failed"),
		);
		const response = await app.request("/oauth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});

		expect(response.status).toBe(500);
		expect(errorSpy).toHaveBeenCalled();
	});

	test("registration rejects an unknown API key", async () => {
		const response = await app.request("/oauth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				api_key: "unknown-api-key",
				redirect_uris: [REDIRECT_URI],
			}),
		});
		expect(response.status).toBe(401);
	});

	test("registration returns random client credentials, not the API key", async () => {
		const client = await register();
		expect(client.redirect_uris).toEqual([REDIRECT_URI]);
		expect(JSON.stringify(client).includes(API_KEY)).toBe(false);
	});

	test("authorize requires PKCE", async () => {
		const client = await register();
		const location = await authorize(client.client_id);
		expect(location.searchParams.get("error")).toBe("invalid_request");
		expect(location.searchParams.has("code")).toBe(false);
	});

	test("the authorization code does not encode the API key", async () => {
		const client = await register();
		const code = (
			await authorize(client.client_id, newPkce().challenge)
		).searchParams.get("code")!;
		const decoded = Buffer.from(code, "base64url").toString("latin1");
		expect(code.includes(API_KEY)).toBe(false);
		expect(decoded.includes(API_KEY)).toBe(false);
	});

	test("token exchange requires the code verifier and client secret", async () => {
		const client = await register();
		const { verifier, challenge } = newPkce();
		const code = (
			await authorize(client.client_id, challenge)
		).searchParams.get("code")!;
		const base = {
			grant_type: "authorization_code",
			code,
			client_id: client.client_id,
		};

		const noVerifier = await token({
			...base,
			client_secret: client.client_secret,
		});
		expect(noVerifier.status).toBe(400);
		expect(noVerifier.body.access_token).toBeUndefined();

		const wrongSecret = await token({
			...base,
			code_verifier: verifier,
			client_secret: "wrong-secret",
		});
		expect(wrongSecret.status).toBe(401);

		const wrongVerifier = await token({
			...base,
			code_verifier: newPkce().verifier,
			client_secret: client.client_secret,
		});
		expect(wrongVerifier.status).toBe(400);
		expect(wrongVerifier.body.error).toBe("invalid_grant");
	});

	test("issues opaque tokens that authenticate MCP and the code is single use", async () => {
		const { client, code, verifier, tokens } = await completeFlow();
		expect(tokens.access_token).toBeDefined();
		expect(tokens.refresh_token).toBeDefined();
		expect(JSON.stringify(tokens).includes(API_KEY)).toBe(false);
		expect(await callMcp(tokens.access_token!)).toBe(200);
		expect(await callMcp("mcp_at_unknown")).toBe(401);

		const replay = await token({
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			client_id: client.client_id,
			client_secret: client.client_secret,
		});
		expect(replay.status).toBe(400);
		expect(replay.body.error).toBe("invalid_grant");
	});

	test("refresh tokens rotate", async () => {
		const { client, tokens } = await completeFlow();
		const refresh = {
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token!,
			client_id: client.client_id,
			client_secret: client.client_secret,
		};
		const refreshed = await token(refresh);
		expect(refreshed.status).toBe(200);
		expect(await callMcp(refreshed.body.access_token!)).toBe(200);
		expect((await token(refresh)).status).toBe(400);
	});

	test("revocation requires the owning client", async () => {
		const { client, tokens } = await completeFlow();
		const other = await register();
		const revoke = (params: Record<string, string>) =>
			app.request("/oauth/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams(params).toString(),
			});

		const token = tokens.access_token!;
		expect((await revoke({ token })).status).toBe(401);
		expect(
			(
				await revoke({
					token,
					client_id: client.client_id,
					client_secret: "wrong-secret",
				})
			).status,
		).toBe(401);
		const foreign = await revoke({
			token,
			client_id: other.client_id,
			client_secret: other.client_secret,
		});
		expect(foreign.status).toBe(200);
		expect(await callMcp(token)).toBe(200);

		const own = await revoke({
			token,
			client_id: client.client_id,
			client_secret: client.client_secret,
		});
		expect(own.status).toBe(200);
		expect(await callMcp(token)).toBe(401);
	});

	test("grants survive a hash-secret rotation", async () => {
		const previousSecret = getApiKeyHashSecret();
		const { client, tokens } = await completeFlow();
		vi.stubEnv(
			"GATEWAY_API_KEY_HASH_SECRET",
			`secret-after-rotation,${previousSecret}`,
		);
		expect(await callMcp(tokens.access_token!)).toBe(200);
		const refreshed = await token({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token!,
			client_id: client.client_id,
			client_secret: client.client_secret,
		});
		expect(refreshed.status).toBe(200);
		expect(await callMcp(refreshed.body.access_token!)).toBe(200);
	});

	test("deactivating the API key revokes every grant", async () => {
		const { client, tokens } = await completeFlow();
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.id, "oauth-api-key"));
		await clearCacheExceptOAuthState();

		expect(await callMcp(tokens.access_token!)).toBe(401);
		const refreshed = await token({
			grant_type: "refresh_token",
			refresh_token: tokens.refresh_token!,
			client_id: client.client_id,
			client_secret: client.client_secret,
		});
		expect(refreshed.status).toBe(400);
	});

	test("a client can delete its registration", async () => {
		const { client, tokens } = await completeFlow();
		const basic = (secret: string) =>
			`Basic ${Buffer.from(`${client.client_id}:${secret}`).toString("base64")}`;
		const path = `/oauth/register/${client.client_id}`;

		const wrongSecret = await app.request(path, {
			method: "DELETE",
			headers: { Authorization: basic("wrong-secret") },
		});
		expect(wrongSecret.status).toBe(401);

		const deleted = await app.request(path, {
			method: "DELETE",
			headers: { Authorization: basic(client.client_secret) },
		});
		expect(deleted.status).toBe(204);
		expect(await callMcp(tokens.access_token!)).toBe(401);
		expect(
			(
				await token({
					grant_type: "refresh_token",
					refresh_token: tokens.refresh_token!,
					client_id: client.client_id,
					client_secret: client.client_secret,
				})
			).status,
		).toBe(401);

		const response = await app.request(
			`/oauth/authorize?${new URLSearchParams({
				client_id: client.client_id,
				redirect_uri: REDIRECT_URI,
			})}`,
		);
		expect(response.status).toBe(401);
	});
});
