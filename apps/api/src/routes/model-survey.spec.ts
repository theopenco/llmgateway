import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, desc, eq, tables } from "@llmgateway/db";

const ORG_ID = "test-survey-org";
const PROJECT_ID = "test-survey-project";
const YEAR = new Date().getUTCFullYear();
const QUARTER = Math.floor(new Date().getUTCMonth() / 3) + 1;
// The wave immediately before the current one, crossing years when needed.
const PREV_PERIOD =
	QUARTER > 1
		? { year: YEAR, quarter: QUARTER - 1 }
		: { year: YEAR - 1, quarter: 4 };
const HOUR_MS = 60 * 60 * 1000;

async function insertOrg(
	overrides: Partial<typeof tables.organization.$inferInsert> = {},
) {
	await db.insert(tables.organization).values({
		id: ORG_ID,
		name: "Personal Org",
		billingEmail: "admin@example.com",
		kind: "devpass",
		devPlan: "pro",
		...overrides,
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
		mode: "credits",
	});
}

let statsCounter = 0;

async function seedModelStats(
	usedModel: string,
	usedProvider: string,
	requestCount: number,
	{ hoursAgo = 2 }: { hoursAgo?: number } = {},
) {
	const offsetMs = hoursAgo * HOUR_MS;
	const hourTimestamp = new Date(Date.now() - offsetMs);
	hourTimestamp.setMinutes(0, 0, 0);
	await db.insert(tables.projectHourlyModelStats).values({
		id: `survey-stats-${statsCounter++}`,
		projectId: PROJECT_ID,
		hourTimestamp,
		usedModel,
		usedProvider,
		requestCount,
	});
}

function eligibilityRequest(token?: string) {
	return app.request("/model-survey/eligibility", {
		headers: token ? { Cookie: token } : {},
	});
}

function submitRequest(body: Record<string, unknown>, token?: string) {
	return app.request("/model-survey", {
		method: "POST",
		headers: {
			...(token ? { Cookie: token } : {}),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

const validBody = {
	modelId: "survey-coder-large",
	valueScore: 5,
	qualityScore: 4,
	speedScore: 3,
	wouldRecommend: true,
	primaryUseCase: "agentic_coding",
	comment: "Great value for agentic work.",
};

async function getOrg() {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
	if (!org) {
		throw new Error("test org disappeared");
	}
	return org;
}

describe("model survey eligibility", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("requires authentication", async () => {
		const res = await eligibilityRequest();
		expect(res.status).toBe(401);
	});

	it("is not eligible without a devpass org", async () => {
		const res = await eligibilityRequest(token);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.eligible).toBe(false);
		expect(json.devPlan).toBeNull();
		expect(json.topModels).toEqual([]);
	});

	it("is not eligible without an active plan", async () => {
		await insertOrg({ devPlan: "none" });
		await seedModelStats("survey-coder-large", "openai", 200);

		const res = await eligibilityRequest(token);
		const json = await res.json();
		expect(json.eligible).toBe(false);
		expect(json.devPlan).toBe("none");
		expect(json.topModels).toEqual([]);
	});

	it("returns qualifying models most-used first", async () => {
		await insertOrg();
		await seedModelStats("survey-coder-large", "openai", 80);
		await seedModelStats("anthropic/survey-coder-small:free", "anthropic", 120);
		// Below the request threshold: excluded.
		await seedModelStats("survey-coder-rare", "openai", 10);
		// Old usage outside the window: excluded.
		await seedModelStats("survey-coder-stale", "openai", 500, {
			hoursAgo: 45 * 24,
		});

		const res = await eligibilityRequest(token);
		const json = await res.json();
		expect(json.year).toBe(YEAR);
		expect(json.eligible).toBe(true);
		expect(json.rewardAvailable).toBe(true);
		expect(json.devPlan).toBe("pro");
		expect(json.topModels).toEqual([
			{
				modelId: "survey-coder-small",
				provider: "anthropic",
				requestCount: 120,
				alreadySubmitted: false,
			},
			{
				modelId: "survey-coder-large",
				provider: "openai",
				requestCount: 80,
				alreadySubmitted: false,
			},
		]);
	});
});

describe("model survey submit", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	it("requires authentication", async () => {
		const res = await submitRequest(validBody);
		expect(res.status).toBe(401);
	});

	it("rejects users without a devpass org", async () => {
		const res = await submitRequest(validBody, token);
		expect(res.status).toBe(403);
	});

	it("rejects models below the usage threshold", async () => {
		await insertOrg();
		await seedModelStats("survey-coder-large", "openai", 49);

		const res = await submitRequest(validBody, token);
		expect(res.status).toBe(403);
	});

	it("rejects a missing or blank comment", async () => {
		await insertOrg();
		await seedModelStats("survey-coder-large", "openai", 80);

		const { comment: _comment, ...withoutComment } = validBody;
		expect((await submitRequest(withoutComment, token)).status).toBe(400);
		expect(
			(await submitRequest({ ...validBody, comment: "   " }, token)).status,
		).toBe(400);
	});

	it("records the response and grants one reset pass per org per year", async () => {
		await insertOrg();
		await seedModelStats("survey-coder-large", "openai", 80);
		await seedModelStats("survey-coder-small", "anthropic", 120);

		const res = await submitRequest(
			{ ...validBody, comment: "Great value for agentic work." },
			token,
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.rewardGranted).toBe(true);
		expect(json.rewardTier).toBe("pro");
		expect(json.response.modelId).toBe("survey-coder-large");

		const org = await getOrg();
		expect(org.devPlanResetPassesPro).toBe(1);
		expect(org.devPlanResetPassesLite).toBe(0);

		const stored = await db.query.modelSurveyResponse.findFirst({
			where: {
				userId: { eq: "test-user-id" },
				modelId: { eq: "survey-coder-large" },
			},
		});
		expect(stored).toMatchObject({
			year: YEAR,
			quarter: QUARTER,
			organizationId: ORG_ID,
			valueScore: 5,
			qualityScore: 4,
			speedScore: 3,
			wouldRecommend: true,
			primaryUseCase: "agentic_coding",
			comment: "Great value for agentic work.",
			requestCount: 80,
			devPlanTier: "pro",
			rewardTier: "pro",
		});

		const [transaction] = await db
			.select()
			.from(tables.transaction)
			.where(eq(tables.transaction.organizationId, ORG_ID))
			.orderBy(desc(tables.transaction.createdAt));
		expect(transaction).toMatchObject({
			type: "dev_plan_reset_pass_reward",
			amount: "0",
			status: "completed",
		});

		// A second model the same year still records, but never double-rewards.
		const second = await submitRequest(
			{ ...validBody, modelId: "survey-coder-small" },
			token,
		);
		expect(second.status).toBe(200);
		const secondJson = await second.json();
		expect(secondJson.rewardGranted).toBe(false);
		expect(secondJson.rewardTier).toBeNull();
		expect((await getOrg()).devPlanResetPassesPro).toBe(1);

		// Eligibility now reflects both submissions and the spent reward.
		const eligibility = await (await eligibilityRequest(token)).json();
		expect(eligibility.eligible).toBe(false);
		expect(eligibility.rewardAvailable).toBe(false);
		expect(
			eligibility.topModels.every(
				(m: { alreadySubmitted: boolean }) => m.alreadySubmitted,
			),
		).toBe(true);
	});

	it("rejects a duplicate response for the same model and quarter", async () => {
		await insertOrg();
		await seedModelStats("survey-coder-large", "openai", 80);

		expect((await submitRequest(validBody, token)).status).toBe(200);
		const res = await submitRequest(validBody, token);
		expect(res.status).toBe(409);
	});

	it("re-opens ratings and the reward in a new quarter", async () => {
		await insertOrg();
		await seedModelStats("survey-coder-large", "openai", 80);

		// Last wave: same model already rated AND the org's reward already spent.
		await db.insert(tables.modelSurveyResponse).values({
			year: PREV_PERIOD.year,
			quarter: PREV_PERIOD.quarter,
			userId: "test-user-id",
			organizationId: ORG_ID,
			modelId: "survey-coder-large",
			valueScore: 3,
			qualityScore: 3,
			speedScore: 3,
			wouldRecommend: false,
			primaryUseCase: "debugging",
			comment: "Last wave verdict.",
			requestCount: 90,
			devPlanTier: "pro",
			rewardTier: "pro",
		});

		const eligibility = await (await eligibilityRequest(token)).json();
		expect(eligibility.quarter).toBe(QUARTER);
		expect(eligibility.eligible).toBe(true);
		expect(eligibility.rewardAvailable).toBe(true);

		const res = await submitRequest(validBody, token);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.response.quarter).toBe(QUARTER);
		expect(json.rewardGranted).toBe(true);
		expect((await getOrg()).devPlanResetPassesPro).toBe(1);
	});

	it("grants the pass on the org's current tier", async () => {
		await insertOrg({ devPlan: "lite" });
		await seedModelStats("survey-coder-large", "openai", 80);

		const res = await submitRequest(validBody, token);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.rewardTier).toBe("lite");

		const org = await getOrg();
		expect(org.devPlanResetPassesLite).toBe(1);
		expect(org.devPlanResetPassesPro).toBe(0);
	});
});

describe("public model survey results", () => {
	beforeEach(async () => {
		await createTestUser();
		await insertOrg();
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function insertResponses(
		modelId: string,
		responses: {
			valueScore: number;
			qualityScore?: number;
			speedScore?: number;
			wouldRecommend?: boolean;
			primaryUseCase?: string;
		}[],
	) {
		for (const [index, response] of responses.entries()) {
			const userId = `survey-user-${modelId}-${index}`;
			await db.insert(tables.user).values({
				id: userId,
				name: `Survey User ${index}`,
				email: `${userId}@example.com`,
			});
			await db.insert(tables.modelSurveyResponse).values({
				year: YEAR,
				quarter: QUARTER,
				userId,
				organizationId: ORG_ID,
				modelId,
				valueScore: response.valueScore,
				qualityScore: response.qualityScore ?? 4,
				speedScore: response.speedScore ?? 3,
				wouldRecommend: response.wouldRecommend ?? true,
				primaryUseCase: (response.primaryUseCase ??
					"agentic_coding") as "agentic_coding",
				requestCount: 100,
				devPlanTier: "pro",
			});
		}
	}

	it("returns empty results when nothing was submitted", async () => {
		const res = await app.request(`/public/model-survey/results?year=${YEAR}`);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toMatchObject({
			year: YEAR,
			totalResponses: 0,
			totalRespondents: 0,
			totalModelsRated: 0,
			models: [],
		});
	});

	it("suppresses models below the anonymity threshold from results and totals", async () => {
		await insertResponses("survey-coder-small", [
			{ valueScore: 5 },
			{ valueScore: 4 },
			{ valueScore: 5 },
			{ valueScore: 3 },
		]);

		const res = await app.request(`/public/model-survey/results?year=${YEAR}`);
		const json = await res.json();
		expect(json.totalResponses).toBe(0);
		expect(json.totalRespondents).toBe(0);
		expect(json.totalModelsRated).toBe(0);
		expect(json.models).toEqual([]);
	});

	it("aggregates published models sorted by value score", async () => {
		await insertResponses("survey-coder-small", [
			{ valueScore: 3, wouldRecommend: false },
			{ valueScore: 3 },
			{ valueScore: 4 },
			{ valueScore: 3, primaryUseCase: "debugging" },
			{ valueScore: 3, primaryUseCase: "debugging" },
		]);
		await insertResponses("survey-coder-large", [
			{ valueScore: 5, qualityScore: 5 },
			{ valueScore: 4 },
			{ valueScore: 5 },
			{ valueScore: 5 },
			{ valueScore: 4, wouldRecommend: false, primaryUseCase: "code_review" },
		]);

		const res = await app.request(`/public/model-survey/results?year=${YEAR}`);
		const json = await res.json();
		expect(json.totalResponses).toBe(10);
		expect(json.totalRespondents).toBe(10);
		expect(json.models).toHaveLength(2);

		const [first, second] = json.models;
		expect(first.modelId).toBe("survey-coder-large");
		expect(first.responseCount).toBe(5);
		expect(first.avgValueScore).toBe(4.6);
		expect(first.recommendPercent).toBe(80);
		// The lone code_review response stays suppressed from the buckets.
		expect(first.useCases).toEqual([{ useCase: "agentic_coding", count: 4 }]);
		expect(second.modelId).toBe("survey-coder-small");
		expect(second.avgValueScore).toBe(3.2);
		expect(second.useCases).toEqual([
			{ useCase: "agentic_coding", count: 3 },
			{ useCase: "debugging", count: 2 },
		]);
	});

	it("scopes results to the requested year", async () => {
		await insertResponses("survey-coder-large", [
			{ valueScore: 5 },
			{ valueScore: 5 },
			{ valueScore: 5 },
			{ valueScore: 5 },
			{ valueScore: 5 },
		]);

		const res = await app.request(
			`/public/model-survey/results?year=${YEAR + 1}`,
		);
		const json = await res.json();
		expect(json.year).toBe(YEAR + 1);
		expect(json.totalResponses).toBe(0);
		expect(json.models).toEqual([]);
	});
});
