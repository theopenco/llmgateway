import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	and,
	count,
	countDistinct,
	db,
	eq,
	inArray,
	MODEL_SURVEY_USE_CASES,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const publicModelSurvey = new OpenAPIHono<ServerTypes>();

// Models need at least this many responses before their scores are published,
// so no individual respondent's answers can be inferred from the report.
export const MIN_PUBLIC_RESPONSES = 5;

// Per-use-case buckets inside a published model are additionally suppressed
// below this count, so a bucket never describes a single respondent.
export const MIN_USE_CASE_BUCKET = 2;

const useCaseEnum = z.enum(MODEL_SURVEY_USE_CASES);

const modelResultSchema = z.object({
	modelId: z.string(),
	responseCount: z.number().int(),
	avgValueScore: z.number(),
	avgQualityScore: z.number(),
	avgSpeedScore: z.number(),
	recommendPercent: z.number().int(),
	useCases: z.array(
		z.object({ useCase: useCaseEnum, count: z.number().int() }),
	),
});

const resultsSchema = z.object({
	year: z.number().int(),
	minResponses: z.number().int(),
	totalResponses: z.number().int(),
	totalRespondents: z.number().int(),
	totalModelsRated: z.number().int(),
	models: z.array(modelResultSchema),
});

const getResults = createRoute({
	method: "get",
	path: "/results",
	request: {
		query: z.object({
			year: z.coerce.number().int().min(2026).max(2100).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: resultsSchema },
			},
			description:
				"Aggregated, anonymized results of the yearly DevPass model survey. Only models with enough responses are listed.",
		},
	},
});

publicModelSurvey.openapi(getResults, async (c) => {
	const { year: queryYear } = c.req.valid("query");
	const year = queryYear ?? new Date().getUTCFullYear();

	const round2 = (value: string | number | null) =>
		Math.round(Number(value ?? 0) * 100) / 100;

	const modelRows = await db
		.select({
			modelId: tables.modelSurveyResponse.modelId,
			responseCount: count(),
			avgValueScore: sql<string>`AVG(${tables.modelSurveyResponse.valueScore})`,
			avgQualityScore: sql<string>`AVG(${tables.modelSurveyResponse.qualityScore})`,
			avgSpeedScore: sql<string>`AVG(${tables.modelSurveyResponse.speedScore})`,
			recommendCount: sql<number>`SUM(CASE WHEN ${tables.modelSurveyResponse.wouldRecommend} THEN 1 ELSE 0 END)`,
		})
		.from(tables.modelSurveyResponse)
		.where(eq(tables.modelSurveyResponse.year, year))
		.groupBy(tables.modelSurveyResponse.modelId)
		.having(sql`COUNT(*) >= ${MIN_PUBLIC_RESPONSES}`)
		.orderBy(
			sql`AVG(${tables.modelSurveyResponse.valueScore}) DESC`,
			sql`COUNT(*) DESC`,
		);

	const publishedModelIds = modelRows.map((row) => row.modelId);

	// Every published number — the stat tiles included — is derived from the
	// published registry only, so sub-threshold models never leak through the
	// totals and the tiles always agree with the table below them.
	const totalResponses = modelRows.reduce(
		(sum, row) => sum + Number(row.responseCount),
		0,
	);
	const [respondents] = publishedModelIds.length
		? await db
				.select({
					value: countDistinct(tables.modelSurveyResponse.userId),
				})
				.from(tables.modelSurveyResponse)
				.where(
					and(
						eq(tables.modelSurveyResponse.year, year),
						inArray(tables.modelSurveyResponse.modelId, publishedModelIds),
					),
				)
		: [{ value: 0 }];

	const useCaseRows = publishedModelIds.length
		? await db
				.select({
					modelId: tables.modelSurveyResponse.modelId,
					useCase: tables.modelSurveyResponse.primaryUseCase,
					count: count(),
				})
				.from(tables.modelSurveyResponse)
				.where(eq(tables.modelSurveyResponse.year, year))
				.groupBy(
					tables.modelSurveyResponse.modelId,
					tables.modelSurveyResponse.primaryUseCase,
				)
		: [];

	const useCasesByModel = new Map<
		string,
		{ useCase: (typeof useCaseRows)[number]["useCase"]; count: number }[]
	>();
	for (const row of useCaseRows) {
		if (
			!publishedModelIds.includes(row.modelId) ||
			Number(row.count) < MIN_USE_CASE_BUCKET
		) {
			continue;
		}
		const list = useCasesByModel.get(row.modelId) ?? [];
		list.push({ useCase: row.useCase, count: Number(row.count) });
		useCasesByModel.set(row.modelId, list);
	}

	return c.json({
		year,
		minResponses: MIN_PUBLIC_RESPONSES,
		totalResponses,
		totalRespondents: Number(respondents?.value ?? 0),
		totalModelsRated: modelRows.length,
		models: modelRows.map((row) => {
			const responseCount = Number(row.responseCount);
			return {
				modelId: row.modelId,
				responseCount,
				avgValueScore: round2(row.avgValueScore),
				avgQualityScore: round2(row.avgQualityScore),
				avgSpeedScore: round2(row.avgSpeedScore),
				recommendPercent: responseCount
					? Math.round((Number(row.recommendCount) / responseCount) * 100)
					: 0,
				useCases: (useCasesByModel.get(row.modelId) ?? []).sort(
					(a, b) => b.count - a.count,
				),
			};
		}),
	});
});

export { publicModelSurvey };
