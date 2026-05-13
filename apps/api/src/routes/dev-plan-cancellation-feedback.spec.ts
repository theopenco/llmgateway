import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const PERSONAL_ORG_ID = "test-personal-org-feedback";
const SUB_ID = "sub_feedback_test_001";

async function seedCancelledDevPlan(opts?: { devPlanCancelled?: boolean }) {
	await db.insert(tables.organization).values({
		id: PERSONAL_ORG_ID,
		name: "Test User's Workspace",
		billingEmail: "admin@example.com",
		isPersonal: true,
		devPlan: "pro",
		devPlanStripeSubscriptionId: SUB_ID,
		devPlanCancelled: opts?.devPlanCancelled ?? true,
		devPlanExpiresAt: new Date("2026-06-08T00:00:00Z"),
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: PERSONAL_ORG_ID,
		role: "owner",
	});
}

describe("dev-plan-cancellation-feedback", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await db.delete(tables.devPlanCancellationFeedback);
		await deleteAll();
	});

	test("GET /eligibility returns eligible=false when no cancelled dev plan", async () => {
		const res = await app.request(
			"/dev-plan-cancellation-feedback/eligibility",
			{
				headers: { Cookie: token },
			},
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.eligible).toBe(false);
		expect(body.existingFeedback).toBeNull();
	});

	test("GET /eligibility returns eligible=true with no existing feedback", async () => {
		await seedCancelledDevPlan();

		const res = await app.request(
			"/dev-plan-cancellation-feedback/eligibility",
			{
				headers: { Cookie: token },
			},
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.eligible).toBe(true);
		expect(body.subscriptionId).toBe(SUB_ID);
		expect(body.previousDevPlan).toBe("pro");
		expect(body.existingFeedback).toBeNull();
	});

	test("POST / inserts a feedback row", async () => {
		await seedCancelledDevPlan();

		const res = await app.request("/dev-plan-cancellation-feedback/submit", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				reason: "too_expensive",
				comments: "Solid product, but more than my hobby budget.",
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true });

		const rows = await db.query.devPlanCancellationFeedback.findMany({
			where: { organizationId: { eq: PERSONAL_ORG_ID } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].reason).toBe("too_expensive");
		expect(rows[0].comments).toContain("hobby budget");
		expect(rows[0].previousDevPlan).toBe("pro");
		expect(rows[0].userId).toBe("test-user-id");
	});

	test("POST / upserts on duplicate submit (no second row)", async () => {
		await seedCancelledDevPlan();

		await app.request("/dev-plan-cancellation-feedback/submit", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ reason: "too_expensive", comments: "first" }),
		});

		const res = await app.request("/dev-plan-cancellation-feedback/submit", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				reason: "missing_features",
				comments: "second",
			}),
		});
		expect(res.status).toBe(200);

		const rows = await db.query.devPlanCancellationFeedback.findMany({
			where: { organizationId: { eq: PERSONAL_ORG_ID } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].reason).toBe("missing_features");
		expect(rows[0].comments).toBe("second");
	});

	test("GET /eligibility surfaces existing feedback for revisit", async () => {
		await seedCancelledDevPlan();

		await app.request("/dev-plan-cancellation-feedback/submit", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				reason: "switched_alternative",
				comments: "moved to vendor X",
			}),
		});

		const res = await app.request(
			"/dev-plan-cancellation-feedback/eligibility",
			{
				headers: { Cookie: token },
			},
		);
		const body = await res.json();
		expect(body.existingFeedback).not.toBeNull();
		expect(body.existingFeedback.reason).toBe("switched_alternative");
		expect(body.existingFeedback.comments).toBe("moved to vendor X");
	});

	test("POST / rejects when no cancelled dev plan exists", async () => {
		const res = await app.request("/dev-plan-cancellation-feedback/submit", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ reason: "other", comments: "" }),
		});
		expect(res.status).toBe(400);
	});

	test("requires authentication", async () => {
		const res = await app.request(
			"/dev-plan-cancellation-feedback/eligibility",
		);
		expect(res.status).toBe(401);
	});
});
