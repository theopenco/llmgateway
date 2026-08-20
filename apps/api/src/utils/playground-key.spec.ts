import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import {
	getOrCreatePlaygroundApiKey,
	getGatewayUrl,
	getPlaygroundKeyCookieName,
	PLAYGROUND_KEY_COOKIE_NAME,
	resolvePlaygroundToken,
} from "@/utils/playground-key.js";

import { db, eq, inArray, tables } from "@llmgateway/db";
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
		expect(firstCookie).toContain(
			`${getPlaygroundKeyCookieName(project.id)}=${firstBody.token}`,
		);
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

	test("does not reuse another user's playground key", async () => {
		await resolver.request("/");
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

		await db.insert(tables.user).values({
			id: "other-playground-user",
			name: "Other Playground User",
			email: "other-playground@example.com",
			emailVerified: true,
		});
		await db.insert(tables.apiKey).values({
			token: "other-playground-token",
			projectId: project.id,
			description: "Auto-generated playground key",
			createdBy: "other-playground-user",
		});

		const result = await getOrCreatePlaygroundApiKey(
			project.id,
			"test-user-id",
			"other-playground-token",
		);
		expect(result.issued).toBe(true);
		expect(result.token).not.toBe("other-playground-token");
	});

	test("migrates a legacy session key without changing its token", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
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
		const [tokenHash] = getApiKeyFingerprints(firstBody.token);
		const key = await db.query.apiKey.findFirst({
			where: { tokenHash: { eq: tokenHash } },
		});
		if (!key) {
			throw new Error("Playground key was not created");
		}

		await db
			.update(tables.apiKey)
			.set({
				token: firstBody.token,
				tokenHash: null,
				tokenMasked: null,
				expiresAt: null,
			})
			.where(eq(tables.apiKey.id, key.id));

		const response = await resolver.request("/", {
			headers: {
				Cookie: `${getPlaygroundKeyCookieName(project.id)}=${firstBody.token}`,
			},
		});
		expect(await response.json()).toEqual({ token: firstBody.token });
		expect(response.headers.get("set-cookie")).toContain(
			`${getPlaygroundKeyCookieName(project.id)}=${firstBody.token}`,
		);

		const migrated = await db.query.apiKey.findFirst({
			where: { id: { eq: key.id } },
		});
		expect(migrated?.token).toBeNull();
		expect(migrated?.tokenHash).toBe(tokenHash);
		expect(migrated?.tokenMasked).not.toBeNull();
		expect(migrated?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
	});

	test("reuses project-scoped cookies when switching projects", async () => {
		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: "test-user-id" } },
		});
		if (!membership) {
			throw new Error("Default organization membership was not created");
		}
		const projects = await db
			.insert(tables.project)
			.values([
				{
					name: "Playground Project A",
					organizationId: membership.organizationId,
				},
				{
					name: "Playground Project B",
					organizationId: membership.organizationId,
				},
			])
			.returning();
		const [projectA, projectB] = projects;
		if (!projectA || !projectB) {
			throw new Error("Playground projects were not created");
		}

		const ensure = async (projectId: string, cookie = authCookie) => {
			const response = await app.request("/playground/ensure-key", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: cookie,
				},
				body: JSON.stringify({ projectId }),
			});
			expect(response.status).toBe(200);
			return {
				body: await response.json(),
				cookie: response.headers.get("set-cookie"),
			};
		};

		const firstA = await ensure(projectA.id);
		const firstB = await ensure(projectB.id);
		const scopedACookie = `${getPlaygroundKeyCookieName(projectA.id)}=${firstA.body.token}`;
		const secondA = await ensure(
			projectA.id,
			`${authCookie}; ${scopedACookie}`,
		);

		expect(firstA.cookie).toContain(scopedACookie);
		expect(firstB.cookie).toContain(getPlaygroundKeyCookieName(projectB.id));
		expect(secondA.body.token).toBe(firstA.body.token);
		expect(
			await db.$count(
				tables.apiKey,
				inArray(tables.apiKey.projectId, [projectA.id, projectB.id]),
			),
		).toBe(2);
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
