import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";
import {
	getOrCreatePlaygroundApiKey,
	getGatewayUrl,
	PLAYGROUND_KEY_COOKIE_NAME,
	resolvePlaygroundToken,
} from "@/utils/playground-key.js";

import { and, db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprints } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

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

	test("appends the /v1 suffix to GATEWAY_URL", () => {
		process.env.GATEWAY_URL = "http://localhost:4001";
		expect(getGatewayUrl()).toBe("http://localhost:4001/v1");
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

	test("rotates the caller's own key when the cookie is missing", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
		const firstCookie = firstResponse.headers.get("set-cookie");
		expect(firstCookie).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
		);
		expect(firstCookie).toContain("HttpOnly");

		const firstKey = await db.query.apiKey.findFirst({
			where: { kind: { eq: "playground" } },
		});
		if (!firstKey) {
			throw new Error("Playground key was not created");
		}
		expect(firstKey?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
		expect(firstKey?.expiresAt?.getTime()).toBeLessThanOrEqual(
			Date.now() + NINETY_DAYS_MS,
		);

		const secondResponse = await resolver.request("/");
		const secondBody = await secondResponse.json();
		expect(secondBody.token).not.toBe(firstBody.token);
		expect(secondResponse.headers.get("set-cookie")).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${secondBody.token}`,
		);

		const secondKey = await db.query.apiKey.findFirst({
			where: { kind: { eq: "playground" } },
		});
		expect(secondKey?.id).toBe(firstKey?.id);
		expect(
			await db.$count(tables.apiKey, eq(tables.apiKey.kind, "playground")),
		).toBe(1);
		expect(firstKey?.createdBy).toBe(secondKey?.createdBy);

		const staleResponse = await resolver.request("/", {
			headers: {
				Cookie: `${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
			},
		});
		const staleBody = await staleResponse.json();
		expect(staleBody.token).not.toBe(firstBody.token);
		expect(staleBody.token).not.toBe(secondBody.token);
		const rotatedKey = await db.query.apiKey.findFirst({
			where: { id: { eq: firstKey.id } },
		});
		expect(rotatedKey?.tokenHash).not.toBeNull();
		expect(getApiKeyFingerprints(staleBody.token)).toContain(
			rotatedKey?.tokenHash,
		);
		expect(getApiKeyFingerprints(firstBody.token)).not.toContain(
			rotatedKey?.tokenHash,
		);
		expect(getApiKeyFingerprints(secondBody.token)).not.toContain(
			rotatedKey?.tokenHash,
		);

		const reusedResponse = await resolver.request("/", {
			headers: {
				Cookie: `${PLAYGROUND_KEY_COOKIE_NAME}=${staleBody.token}`,
			},
		});
		expect(await reusedResponse.json()).toEqual({ token: staleBody.token });
		expect(reusedResponse.headers.get("set-cookie")).toBeNull();
	});

	test("serializes concurrent first-use requests into one row", async () => {
		const project = await db.query.project.findFirst();
		if (!project) {
			throw new Error("Test project was not created");
		}

		const [firstResult, secondResult] = await Promise.all([
			getOrCreatePlaygroundApiKey(project.id, "test-user-id"),
			getOrCreatePlaygroundApiKey(project.id, "test-user-id"),
		]);

		expect(firstResult.token).not.toBe(secondResult.token);
		expect(
			await db.$count(
				tables.apiKey,
				and(
					eq(tables.apiKey.projectId, project.id),
					eq(tables.apiKey.kind, "playground"),
					eq(tables.apiKey.status, "active"),
				),
			),
		).toBe(1);
	});

	test("gives concurrent members one key each", async () => {
		const project = await db.query.project.findFirst();
		if (!project) {
			throw new Error("Test project was not created");
		}
		await db.insert(tables.user).values({
			id: "other-playground-user",
			name: "Other Playground User",
			email: "other-playground@example.com",
			emailVerified: true,
		});

		const [mine, theirs] = await Promise.all([
			getOrCreatePlaygroundApiKey(project.id, "test-user-id"),
			getOrCreatePlaygroundApiKey(project.id, "other-playground-user"),
		]);

		const keys = await db.query.apiKey.findMany({
			where: {
				projectId: { eq: project.id },
				kind: { eq: "playground" },
				status: { eq: "active" },
			},
		});
		expect(keys).toHaveLength(2);
		for (const [userId, result] of [
			["test-user-id", mine],
			["other-playground-user", theirs],
		] as const) {
			const key = keys.find((candidate) => candidate.createdBy === userId);
			expect(getApiKeyFingerprints(result.token)).toContain(key?.tokenHash);
		}
	});

	test("migrates a matching plaintext key without changing its token", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
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
				description: "Auto-generated playground key",
				expiresAt: null,
			})
			.where(eq(tables.apiKey.id, key.id));

		const response = await resolver.request("/", {
			headers: {
				Cookie: `${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
			},
		});
		expect(await response.json()).toEqual({ token: firstBody.token });
		expect(response.headers.get("set-cookie")).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
		);

		const migrated = await db.query.apiKey.findFirst({
			where: { id: { eq: key.id } },
		});
		expect(migrated?.token).toBeNull();
		expect(migrated?.tokenHash).toBe(tokenHash);
		expect(migrated?.tokenMasked).not.toBeNull();
		expect(migrated?.description).toBe("Playground");
		expect(migrated?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
	});

	test("rotates an expired key without changing its id", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
		const [firstHash] = getApiKeyFingerprints(firstBody.token);
		const firstKey = await db.query.apiKey.findFirst({
			where: { tokenHash: { eq: firstHash } },
		});
		if (!firstKey) {
			throw new Error("Playground key was not created");
		}

		await db
			.update(tables.apiKey)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.apiKey.id, firstKey.id));

		const replacement = await resolver.request("/", {
			headers: {
				Cookie: `${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
			},
		});
		const replacementBody = await replacement.json();
		const [replacementHash] = getApiKeyFingerprints(replacementBody.token);
		const replacementKey = await db.query.apiKey.findFirst({
			where: { tokenHash: { eq: replacementHash } },
		});

		expect(replacementBody.token).not.toBe(firstBody.token);
		expect(replacementKey?.id).toBe(firstKey.id);
		expect(replacement.headers.get("set-cookie")).toContain(
			`${PLAYGROUND_KEY_COOKIE_NAME}=${replacementBody.token}`,
		);
	});

	test("keeps a restored cookie within the stored expiry", async () => {
		const membership = await db.query.userOrganization.findFirst({
			where: { userId: { eq: "test-user-id" } },
		});
		if (!membership) {
			throw new Error("Default organization membership was not created");
		}
		const [project] = await db
			.insert(tables.project)
			.values({
				name: "Playground expiry project",
				organizationId: membership.organizationId,
			})
			.returning();

		const firstResponse = await app.request("/playground/ensure-key", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: authCookie,
			},
			body: JSON.stringify({ projectId: project.id }),
		});
		const firstBody = await firstResponse.json();
		const [tokenHash] = getApiKeyFingerprints(firstBody.token);
		const expiresAt = new Date(Date.now() + ONE_HOUR_MS);
		await db
			.update(tables.apiKey)
			.set({ expiresAt })
			.where(eq(tables.apiKey.tokenHash, tokenHash));

		const refreshedResponse = await app.request("/playground/ensure-key", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: `${authCookie}; ${PLAYGROUND_KEY_COOKIE_NAME}=${firstBody.token}`,
			},
			body: JSON.stringify({ projectId: project.id }),
		});
		const refreshedBody = await refreshedResponse.json();

		expect(refreshedResponse.status).toBe(200);
		expect(refreshedBody.token).toBe(firstBody.token);
		expect(refreshedBody.expiresIn).toBeGreaterThan(3500);
		expect(refreshedBody.expiresIn).toBeLessThanOrEqual(3600);
		expect(refreshedResponse.headers.get("set-cookie")).toContain(
			`Max-Age=${refreshedBody.expiresIn}`,
		);
	});

	test("does not consume the developer-key quota", async () => {
		for (let index = 0; index < 5; index++) {
			await resolver.request("/");
		}

		const chatOrg = await db.query.organization.findFirst({
			where: { kind: { eq: "chat" } },
		});
		const project = chatOrg
			? await db.query.project.findFirst({
					where: { organizationId: { eq: chatOrg.id } },
				})
			: null;
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
		expect(
			await db.$count(tables.apiKey, eq(tables.apiKey.kind, "playground")),
		).toBe(1);
	});

	test("gives another member its own key instead of rotating", async () => {
		const firstResponse = await resolver.request("/");
		const firstBody = await firstResponse.json();
		const key = await db.query.apiKey.findFirst({
			where: { kind: { eq: "playground" } },
		});
		if (!key) {
			throw new Error("Playground key was not created");
		}

		await db.insert(tables.user).values({
			id: "other-playground-user",
			name: "Other Playground User",
			email: "other-playground@example.com",
			emailVerified: true,
		});
		const result = await getOrCreatePlaygroundApiKey(
			key.projectId,
			"other-playground-user",
			firstBody.token,
		);

		expect(result.issued).toBe(true);
		expect(result.token).not.toBe(firstBody.token);

		const untouched = await db.query.apiKey.findFirst({
			where: { id: { eq: key.id } },
		});
		expect(untouched?.createdBy).toBe(key.createdBy);
		expect(getApiKeyFingerprints(firstBody.token)).toContain(
			untouched?.tokenHash,
		);

		const otherKey = await db.query.apiKey.findFirst({
			where: { createdBy: { eq: "other-playground-user" } },
		});
		expect(otherKey?.id).not.toBe(key.id);
		expect(getApiKeyFingerprints(result.token)).toContain(otherKey?.tokenHash);
		expect(
			await db.$count(
				tables.apiKey,
				and(
					eq(tables.apiKey.projectId, key.projectId),
					eq(tables.apiKey.kind, "playground"),
					eq(tables.apiKey.status, "active"),
				),
			),
		).toBe(2);
	});
});
