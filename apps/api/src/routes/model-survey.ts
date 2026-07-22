import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { posthog } from "@/posthog.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	isNotNull,
	MODEL_SURVEY_TIERS,
	MODEL_SURVEY_USE_CASES,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const modelSurvey = new OpenAPIHono<ServerTypes>();

// The yearly DevPass model survey only asks about models a member genuinely
// uses: their DevPass org must have made at least this many requests on a
// model within the qualifying window before it can be rated.
export const MINIMUM_SURVEY_REQUESTS = 50;
export const SURVEY_WINDOW_DAYS = 30;
// How many qualifying models eligibility returns, most-used first.
const TOP_MODELS_LIMIT = 5;

const useCaseEnum = z.enum(MODEL_SURVEY_USE_CASES);

const tierEnum = z.enum(MODEL_SURVEY_TIERS);

// The census runs in quarterly waves: responses and rewards are scoped to a
// (year, quarter) period, and the public report aggregates the whole year.
function surveyPeriod(): { year: number; quarter: number } {
	const now = new Date();
	return {
		year: now.getUTCFullYear(),
		quarter: Math.floor(now.getUTCMonth() / 3) + 1,
	};
}

async function findUserDevpassOrg(userId: string) {
	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId: { eq: userId } },
		with: { organization: true },
	});
	return userOrgs.find((uo) => uo.organization?.kind === "devpass")
		?.organization;
}

// Model names in the stats rollups may be stored as "provider/model" and can
// carry a ":variant" suffix; group on the bare model id like model-ratings does.
const normalizedModelExpr = sql<string>`CASE WHEN ${tables.projectHourlyModelStats.usedModel} LIKE '%/%'
	THEN SPLIT_PART(SPLIT_PART(${tables.projectHourlyModelStats.usedModel}, '/', 2), ':', 1)
	ELSE SPLIT_PART(${tables.projectHourlyModelStats.usedModel}, ':', 1)
END`;

async function getOrgProjectIds(organizationId: string): Promise<string[]> {
	const projects = await db.query.project.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true },
	});
	return projects.map((p) => p.id);
}

const SURVEY_WINDOW_MS = SURVEY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function windowStart(): Date {
	return new Date(Date.now() - SURVEY_WINDOW_MS);
}

async function getQualifyingModels(
	organizationId: string,
): Promise<{ modelId: string; provider: string; requestCount: number }[]> {
	const projectIds = await getOrgProjectIds(organizationId);
	if (projectIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({
			modelId: normalizedModelExpr.as("model_id"),
			provider: sql<string>`MAX(${tables.projectHourlyModelStats.usedProvider})`,
			requestCount: sql<number>`SUM(${tables.projectHourlyModelStats.requestCount})`,
		})
		.from(tables.projectHourlyModelStats)
		.where(
			and(
				inArray(tables.projectHourlyModelStats.projectId, projectIds),
				gte(tables.projectHourlyModelStats.hourTimestamp, windowStart()),
			),
		)
		.groupBy(normalizedModelExpr)
		.having(
			sql`SUM(${tables.projectHourlyModelStats.requestCount}) >= ${MINIMUM_SURVEY_REQUESTS}`,
		)
		.orderBy(sql`SUM(${tables.projectHourlyModelStats.requestCount}) DESC`)
		.limit(TOP_MODELS_LIMIT);

	return rows.map((row) => ({
		modelId: row.modelId,
		provider: row.provider ?? "",
		requestCount: Number(row.requestCount),
	}));
}

async function getModelWindowRequestCount(
	organizationId: string,
	modelId: string,
): Promise<number> {
	const projectIds = await getOrgProjectIds(organizationId);
	if (projectIds.length === 0) {
		return 0;
	}

	const [result] = await db
		.select({
			value: sql<number>`COALESCE(SUM(${tables.projectHourlyModelStats.requestCount}), 0)`,
		})
		.from(tables.projectHourlyModelStats)
		.where(
			and(
				inArray(tables.projectHourlyModelStats.projectId, projectIds),
				gte(tables.projectHourlyModelStats.hourTimestamp, windowStart()),
				sql`${normalizedModelExpr} = ${modelId}`,
			),
		);

	return Number(result?.value ?? 0);
}

async function findRewardedResponse(
	dbOrTx: Pick<typeof db, "select">,
	organizationId: string,
	year: number,
	quarter: number,
) {
	const [row] = await dbOrTx
		.select({ id: tables.modelSurveyResponse.id })
		.from(tables.modelSurveyResponse)
		.where(
			and(
				eq(tables.modelSurveyResponse.organizationId, organizationId),
				eq(tables.modelSurveyResponse.year, year),
				eq(tables.modelSurveyResponse.quarter, quarter),
				isNotNull(tables.modelSurveyResponse.rewardTier),
			),
		)
		.limit(1);
	return row;
}

const topModelSchema = z.object({
	modelId: z.string(),
	provider: z.string(),
	requestCount: z.number().int(),
	alreadySubmitted: z.boolean(),
});

const eligibilitySchema = z.object({
	year: z.number().int(),
	quarter: z.number().int().min(1).max(4),
	eligible: z.boolean(),
	devPlan: z.enum(["none", "lite", "pro", "max"]).nullable(),
	rewardAvailable: z.boolean(),
	minimumRequests: z.number().int(),
	windowDays: z.number().int(),
	topModels: z.array(topModelSchema),
});

const getEligibility = createRoute({
	method: "get",
	path: "/eligibility",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": { schema: eligibilitySchema },
			},
			description:
				"Whether the user can take this quarter's DevPass model survey wave, and for which models.",
		},
	},
});

modelSurvey.openapi(getEligibility, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { year, quarter } = surveyPeriod();
	const org = await findUserDevpassOrg(user.id);

	if (!org || org.devPlan === "none") {
		return c.json({
			year,
			quarter,
			eligible: false,
			devPlan: org?.devPlan ?? null,
			rewardAvailable: false,
			minimumRequests: MINIMUM_SURVEY_REQUESTS,
			windowDays: SURVEY_WINDOW_DAYS,
			topModels: [],
		});
	}

	const [models, ownResponses, rewardedRow] = await Promise.all([
		getQualifyingModels(org.id),
		db.query.modelSurveyResponse.findMany({
			where: {
				userId: { eq: user.id },
				year: { eq: year },
				quarter: { eq: quarter },
			},
			columns: { modelId: true },
		}),
		findRewardedResponse(db, org.id, year, quarter),
	]);

	const submitted = new Set(ownResponses.map((r) => r.modelId));
	const topModels = models.map((m) => ({
		...m,
		alreadySubmitted: submitted.has(m.modelId),
	}));

	return c.json({
		year,
		quarter,
		eligible: topModels.some((m) => !m.alreadySubmitted),
		devPlan: org.devPlan,
		rewardAvailable: !rewardedRow,
		minimumRequests: MINIMUM_SURVEY_REQUESTS,
		windowDays: SURVEY_WINDOW_DAYS,
		topModels,
	});
});

const responseSchema = z.object({
	modelId: z.string(),
	year: z.number().int(),
	quarter: z.number().int().min(1).max(4),
	valueScore: z.number().int().min(1).max(5),
	qualityScore: z.number().int().min(1).max(5),
	speedScore: z.number().int().min(1).max(5),
	wouldRecommend: z.boolean(),
	primaryUseCase: useCaseEnum,
	comment: z.string().nullable(),
	createdAt: z.string().datetime(),
});

const submitSurvey = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						modelId: z.string().min(1),
						valueScore: z.number().int().min(1).max(5),
						qualityScore: z.number().int().min(1).max(5),
						speedScore: z.number().int().min(1).max(5),
						wouldRecommend: z.boolean(),
						primaryUseCase: useCaseEnum,
						comment: z.string().trim().min(1).max(2000),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						rewardGranted: z.boolean(),
						rewardTier: tierEnum.nullable(),
						response: responseSchema,
					}),
				},
			},
			description:
				"Survey response recorded. The org's first response of the year grants a free Reset Pass.",
		},
	},
});

modelSurvey.openapi(submitSurvey, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const {
		modelId,
		valueScore,
		qualityScore,
		speedScore,
		wouldRecommend,
		primaryUseCase,
		comment,
	} = c.req.valid("json");

	const org = await findUserDevpassOrg(user.id);
	if (!org || org.devPlan === "none") {
		throw new HTTPException(403, {
			message:
				"The model survey is only open to DevPass members with an active plan.",
		});
	}
	const tier = org.devPlan;

	const requestCount = await getModelWindowRequestCount(org.id, modelId);
	if (requestCount < MINIMUM_SURVEY_REQUESTS) {
		throw new HTTPException(403, {
			message: `You need at least ${MINIMUM_SURVEY_REQUESTS} requests on this model in the last ${SURVEY_WINDOW_DAYS} days to rate it.`,
		});
	}

	const { year, quarter } = surveyPeriod();

	let row: typeof tables.modelSurveyResponse.$inferSelect;
	let rewardTier: "lite" | "pro" | "max" | null = null;
	try {
		({ row, rewardTier } = await db.transaction(async (tx) => {
			// Lock the org row so concurrent submissions can't both claim the
			// one-per-quarter reward.
			await tx
				.select({ id: tables.organization.id })
				.from(tables.organization)
				.where(eq(tables.organization.id, org.id))
				.for("update");

			const rewardedRow = await findRewardedResponse(tx, org.id, year, quarter);
			const grantTier = rewardedRow ? null : tier;

			const [inserted] = await tx
				.insert(tables.modelSurveyResponse)
				.values({
					year,
					quarter,
					userId: user.id,
					organizationId: org.id,
					modelId,
					valueScore,
					qualityScore,
					speedScore,
					wouldRecommend,
					primaryUseCase,
					comment,
					requestCount,
					devPlanTier: tier,
					rewardTier: grantTier,
				})
				.returning();

			if (grantTier) {
				const purchasedIncrement =
					grantTier === "lite"
						? {
								devPlanResetPassesLite: sql`${tables.organization.devPlanResetPassesLite} + 1`,
							}
						: grantTier === "pro"
							? {
									devPlanResetPassesPro: sql`${tables.organization.devPlanResetPassesPro} + 1`,
								}
							: {
									devPlanResetPassesMax: sql`${tables.organization.devPlanResetPassesMax} + 1`,
								};

				await tx
					.update(tables.organization)
					.set(purchasedIncrement)
					.where(eq(tables.organization.id, org.id));

				await tx.insert(tables.transaction).values({
					organizationId: org.id,
					type: "dev_plan_reset_pass_reward",
					amount: "0",
					currency: "USD",
					status: "completed",
					description: `DevPass Reset Pass (${grantTier.toUpperCase()}) — ${year} Q${quarter} model survey reward`,
				});
			}

			return { row: inserted, rewardTier: grantTier };
		}));
	} catch (error) {
		if (
			error instanceof Error &&
			"cause" in error &&
			(error.cause as { code?: string } | undefined)?.code === "23505"
		) {
			throw new HTTPException(409, {
				message: `You already rated this model in the Q${quarter} ${year} wave.`,
			});
		}
		throw error;
	}

	if (rewardTier) {
		await logAuditEvent({
			organizationId: org.id,
			userId: user.id,
			action: "dev_plan.reset_pass_reward",
			resourceType: "dev_plan",
			resourceId: row.id,
			metadata: { tier: rewardTier, year, quarter, modelId },
		});
	}

	posthog.capture({
		distinctId: user.id,
		event: "model_survey_submitted",
		groups: { organization: org.id },
		properties: {
			year,
			quarter,
			modelId,
			devPlan: tier,
			rewardGranted: rewardTier !== null,
			valueScore,
			qualityScore,
			speedScore,
			wouldRecommend,
			primaryUseCase,
		},
	});

	return c.json({
		success: true,
		rewardGranted: rewardTier !== null,
		rewardTier,
		response: {
			modelId: row.modelId,
			year: row.year,
			quarter: row.quarter,
			valueScore: row.valueScore,
			qualityScore: row.qualityScore,
			speedScore: row.speedScore,
			wouldRecommend: row.wouldRecommend,
			primaryUseCase: row.primaryUseCase,
			comment: row.comment,
			createdAt: row.createdAt.toISOString(),
		},
	});
});
