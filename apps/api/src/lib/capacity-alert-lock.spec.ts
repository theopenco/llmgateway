import { setTimeout } from "node:timers/promises";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createApiKeyForProject } from "@/routes/keys-api.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type * as Discord from "@/utils/discord.js";

const discord = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/utils/discord.js", async (original) => ({
	...(await original<typeof Discord>()),
	notifyOrgLimitReached: discord.send,
}));

beforeEach(async () => {
	await createTestUser();
	discord.send.mockResolvedValue(undefined);
	await db.insert(tables.organization).values({
		id: "limit-alert-test-org",
		name: "Test Organization",
		billingEmail: "admin@example.com",
		plan: "pro",
		proSeats: 3,
	});
	await db.insert(tables.userOrganization).values({
		organizationId: "limit-alert-test-org",
		userId: "test-user-id",
		role: "owner",
	});
	await db.insert(tables.project).values({
		id: "limit-alert-test-project",
		organizationId: "limit-alert-test-org",
		name: "Test Project",
	});
});
afterEach(async () => {
	vi.clearAllMocks();
	await deleteAll();
});

it("releases the balance row before delivering a rejected-capacity notification", async () => {
	for (let i = 0; i < 3; i++) {
		await createApiKeyForProject("limit-alert-test-project", "test-user-id", {
			description: `Test ${i}`,
		});
	}
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	discord.send.mockImplementationOnce(async () => {
		entered();
		await gate;
	});
	const rejectedCreation = createApiKeyForProject(
		"limit-alert-test-project",
		"test-user-id",
		{ description: "Test over limit" },
	).then(
		() => null,
		(error: unknown) => error,
	);
	await started;
	const creditWrite = db
		.update(tables.organization)
		.set({ credits: "1" })
		.where(eq(tables.organization.id, "limit-alert-test-org"))
		.returning();
	let progressed: boolean;
	try {
		progressed = await Promise.race([
			creditWrite.then(() => true),
			setTimeout(1500).then(() => false),
		]);
	} finally {
		release();
		await Promise.all([rejectedCreation, creditWrite]);
	}
	expect(progressed).toBe(true);
	expect(await rejectedCreation).toMatchObject({ status: 400 });
	expect(discord.send).toHaveBeenCalledTimes(1);
	expect(
		await db.query.apiKey.findMany({
			where: { projectId: { eq: "limit-alert-test-project" } },
		}),
	).toHaveLength(3);
});
