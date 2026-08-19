import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import {
	getGatewayUrl,
	PLAYGROUND_KEY_COOKIE_NAME,
	resolvePlaygroundToken,
} from "@/utils/playground-key.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprints } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe("getGatewayUrl", () => {
	const previousGatewayUrl = process.env.GATEWAY_URL;
	const previousNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		if (previousGatewayUrl === undefined) {
			delete process.env.GATEWAY_URL;
		} else {
			process.env.GATEWAY_URL = previousGatewayUrl;
		}
		if (previousNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
	});

	// Deployments and local `.envrc` blocks write GATEWAY_URL both ways, and
	// every caller appends a `/v1` path to what this returns.
	test("appends the /v1 suffix when GATEWAY_URL omits it", () => {
		process.env.GATEWAY_URL = "http://localhost:4001";
		expect(getGatewayUrl()).toBe("http://localhost:4001/v1");
	});

	test("keeps a single /v1 suffix when GATEWAY_URL already has it", () => {
		process.env.GATEWAY_URL = "https://api.llmgateway.io/v1";
		expect(getGatewayUrl()).toBe("https://api.llmgateway.io/v1");
	});

	test("tolerates a trailing slash", () => {
		process.env.GATEWAY_URL = "https://api.llmgateway.io/v1/";
		expect(getGatewayUrl()).toBe("https://api.llmgateway.io/v1");
	});

	test("collapses a repeated /v1 suffix", () => {
		process.env.GATEWAY_URL = "https://gateway.example/v1/v1";
		expect(getGatewayUrl()).toBe("https://gateway.example/v1");
	});

	test("falls back to the local gateway in development", () => {
		delete process.env.GATEWAY_URL;
		process.env.NODE_ENV = "development";
		expect(getGatewayUrl()).toBe("http://localhost:4001/v1");
	});
});

describe("resolvePlaygroundToken", () => {
	let authCookie: string;
	const resolver = new Hono<ServerTypes>();
	resolver.get("/", async (c) => {
		const token = await resolvePlaygroundToken(c, {
			id: "test-user-id",
			email: "admin@example.com",
		});
		return c.json({ token });
	});

	beforeEach(async () => {
		authCookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("issues independent session keys and preserves existing cookies", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
		const firstCookie = firstResponse.headers.get("set-cookie");
		if (!firstCookie) {
			throw new Error("Playground key cookie was not set");
		}
		expect(firstCookie).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
		);
		expect(firstCookie).toContain("HttpOnly");

		const secondResponse = await resolver.request("/");
		const secondBody = await secondResponse.json();
		expect(secondBody.token).not.toBe(firstBody.token);
		expect(secondResponse.headers.get("set-cookie")).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${secondBody.token}`,
		);

		const chatOrg = await db.query.organization.findFirst({
			where: { kind: { eq: "chat" } },
		});
		if (!chatOrg) {
			throw new Error("Chat organization was not created");
		}
		const project = await db.query.project.findFirst({
			where: { organizationId: { eq: chatOrg.id } },
		});
		if (!project) {
			throw new Error("Chat project was not created");
		}
		const keys = await db.query.apiKey.findMany({
			where: {
				projectId: { eq: project.id },
				description: { eq: "Auto-generated playground key" },
				status: { eq: "active" },
			},
		});
		expect(keys).toHaveLength(2);
		expect(
			keys.every(
				(key) =>
					key.expiresAt &&
					key.expiresAt.getTime() > Date.now() &&
					key.expiresAt.getTime() <= Date.now() + THIRTY_DAYS_MS,
			),
		).toBe(true);
		expect(
			keys.some(
				(key) =>
					key.tokenHash !== null &&
					getApiKeyFingerprints(firstBody.token).includes(key.tokenHash),
			),
		).toBe(true);
		expect(
			keys.some(
				(key) =>
					key.tokenHash !== null &&
					getApiKeyFingerprints(secondBody.token).includes(key.tokenHash),
			),
		).toBe(true);

		const reusedResponse = await resolver.request("/", {
			headers: { Cookie: firstCookie.split(";", 1)[0] },
		});
		expect(await reusedResponse.json()).toEqual({ token: firstBody.token });
		expect(reusedResponse.headers.get("set-cookie")).toBeNull();

		const keyCount = await db.$count(
			tables.apiKey,
			eq(tables.apiKey.projectId, project.id),
		);
		expect(keyCount).toBe(2);
	});

	test("expires sessions without consuming developer-key quota", async () => {
		for (let index = 0; index < 5; index++) {
			const response = await resolver.request("/");
			expect(response.headers.get("set-cookie")).toContain(
				PLAYGROUND_KEY_COOKIE_NAME,
			);
		}

		const chatOrg = await db.query.organization.findFirst({
			where: { kind: { eq: "chat" } },
		});
		if (!chatOrg) {
			throw new Error("Chat organization was not created");
		}
		const project = await db.query.project.findFirst({
			where: { organizationId: { eq: chatOrg.id } },
		});
		if (!project) {
			throw new Error("Chat project was not created");
		}

		const createResponse = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: authCookie,
			},
			body: JSON.stringify({
				description: "Developer key",
				projectId: project.id,
			}),
		});

		expect(createResponse.status).toBe(200);
		const body = await createResponse.json();
		expect(body.apiKey.tokenHash).toBeUndefined();
	});

	test("replaces an expired session and resets its cookie", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
		const firstCookie = firstResponse.headers.get("set-cookie");
		if (!firstCookie) {
			throw new Error("Playground key cookie was not set");
		}

		const [firstHash] = getApiKeyFingerprints(firstBody.token);
		await db
			.update(tables.apiKey)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.apiKey.tokenHash, firstHash));

		const replacement = await resolver.request("/", {
			headers: { Cookie: firstCookie.split(";", 1)[0] },
		});
		const replacementBody = await replacement.json();
		expect(replacementBody.token).not.toBe(firstBody.token);
		expect(replacement.headers.get("set-cookie")).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${replacementBody.token}`,
		);
	});
});
