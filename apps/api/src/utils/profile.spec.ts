import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestUser, deleteAll } from "@/testing.js";
import { computeProfileData } from "@/utils/profile.js";

import { db, projectHourlyModelStats, tables } from "@llmgateway/db";

const ORG_ID = "test-profile-org";
const PROJECT_ID = "test-profile-project";

const HOUR_MS = 60 * 60 * 1000;

describe("computeProfileData passport fields", () => {
	beforeEach(async () => {
		await createTestUser();
	});

	afterEach(async () => {
		await db.delete(projectHourlyModelStats);
		await deleteAll();
	});

	async function insertOrg(devPlan: "none" | "pro") {
		const startedAt = new Date("2026-07-05T00:00:00.000Z");
		const expiresAt = new Date("2026-08-05T00:00:00.000Z");
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Personal Org",
			billingEmail: "admin@example.com",
			kind: "devpass",
			devPlan,
			devPlanBillingCycleStart: devPlan === "none" ? null : startedAt,
			devPlanExpiresAt: devPlan === "none" ? null : expiresAt,
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Default Project",
			organizationId: ORG_ID,
		});
		return { startedAt, expiresAt };
	}

	it("exposes the dev plan as the visa validity window", async () => {
		const { startedAt, expiresAt } = await insertOrg("pro");

		const profile = await computeProfileData("test-user-id");
		expect(profile?.plan).toEqual({
			tier: "pro",
			startedAt: startedAt.toISOString(),
			expiresAt: expiresAt.toISOString(),
		});
	});

	it("reports no plan when the org has no active dev plan", async () => {
		await insertOrg("none");

		const profile = await computeProfileData("test-user-id");
		expect(profile?.plan).toBeNull();
	});

	it("returns first/last used timestamps per model for stamps", async () => {
		await insertOrg("pro");

		const early = new Date("2026-06-01T10:00:00.000Z");
		const late = new Date("2026-07-10T15:00:00.000Z");
		await db.insert(projectHourlyModelStats).values([
			{
				projectId: PROJECT_ID,
				hourTimestamp: early,
				usedModel: "gpt-4o",
				usedProvider: "openai",
				requestCount: 3,
				totalTokens: "300",
			},
			{
				projectId: PROJECT_ID,
				hourTimestamp: late,
				usedModel: "gpt-4o",
				usedProvider: "openai",
				requestCount: 5,
				totalTokens: "500",
			},
			{
				projectId: PROJECT_ID,
				hourTimestamp: new Date(late.getTime() + HOUR_MS),
				usedModel: "claude-opus-4-8",
				usedProvider: "anthropic",
				requestCount: 2,
				totalTokens: "200",
			},
		]);

		const profile = await computeProfileData("test-user-id");
		const gpt = profile?.models.find((m) => m.id === "gpt-4o");
		expect(gpt).toBeDefined();
		expect(gpt?.requestCount).toBe(8);
		expect(gpt?.firstUsed).toBe(early.toISOString());
		expect(gpt?.lastUsed).toBe(late.toISOString());

		// A single hour bucket collapses to identical first/last timestamps.
		const opusHour = new Date(late.getTime() + HOUR_MS).toISOString();
		const opus = profile?.models.find((m) => m.id === "claude-opus-4-8");
		expect(opus).toBeDefined();
		expect(opus?.firstUsed).toBe(opusHour);
		expect(opus?.lastUsed).toBe(opusHour);
	});
});
