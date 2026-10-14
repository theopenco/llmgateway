import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	apiKey,
	contentFilterHourlyErrorStats,
	db,
	log,
	organization,
	project,
	user,
} from "@llmgateway/db";

import { calculateContentFilterErrorStatsForHour } from "./content-filter-error-stats-aggregator.js";

import type {
	ContentFilterModerationError,
	GatewayContentFilterEvaluation,
	InferInsertModel,
} from "@llmgateway/db";

const HOUR = new Date("2026-08-07T10:00:00.000Z");
const WITHIN_HOUR = new Date("2026-08-07T10:15:00.000Z");
const LATER_WITHIN_HOUR = new Date("2026-08-07T10:40:00.000Z");

type LogInsert = InferInsertModel<typeof log>;

let logCounter = 0;

const AVIF: ContentFilterModerationError = {
	source: "openai",
	kind: "upstream_4xx",
	inputType: "image",
	status: 400,
	code: "invalid_image_format",
	message: "Unsupported format: image/avif",
};

const TIMEOUT: ContentFilterModerationError = {
	source: "internal",
	kind: "timeout",
	inputType: "text",
	message: "moderation call timed out",
};

function evaluation(
	errors: ContentFilterModerationError[] | undefined,
	overrides: Partial<GatewayContentFilterEvaluation> = {},
): GatewayContentFilterEvaluation {
	return {
		sampled: true,
		provider: "openai",
		tier: 0,
		overridden: false,
		level: "strict",
		violation: false,
		action: "passed",
		enforced: false,
		flagged: false,
		matchedCategories: [],
		categoryScores: {},
		moderationFailed: errors !== undefined,
		classifier: "internal",
		...(errors ? { moderationErrors: errors } : {}),
		...overrides,
	};
}

function logRow(overrides: Partial<LogInsert> = {}): LogInsert {
	logCounter += 1;
	return {
		id: `cfe-log-${logCounter}`,
		requestId: `cfe-req-${logCounter}`,
		organizationId: "cfe-org",
		projectId: "cfe-proj",
		apiKeyId: "cfe-key",
		duration: 100,
		requestedModel: "gpt-5.6-sol",
		usedModel: "openai/gpt-5.6-sol",
		usedProvider: "openai",
		responseSize: 10,
		hasError: false,
		mode: "credits",
		usedMode: "credits",
		createdAt: WITHIN_HOUR,
		...overrides,
	};
}

async function rows() {
	return (await db.select().from(contentFilterHourlyErrorStats))
		.map((row) => ({
			hourTimestamp: row.hourTimestamp,
			organizationId: row.organizationId,
			projectId: row.projectId,
			classifier: row.classifier,
			source: row.source,
			kind: row.kind,
			inputType: row.inputType,
			status: row.status,
			code: row.code,
			errorCount: row.errorCount,
			lastMessage: row.lastMessage,
			lastRequestId: row.lastRequestId,
			lastSeenAt: row.lastSeenAt,
		}))
		.sort((a, b) => a.kind.localeCompare(b.kind));
}

describe("content filter error stats aggregator", () => {
	beforeEach(async () => {
		vi.setSystemTime(new Date("2026-08-08T00:00:00Z"));
		await db.delete(contentFilterHourlyErrorStats);
		await db.delete(log);
		await db.delete(apiKey);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);

		const [testUser] = await db
			.insert(user)
			.values({ email: "content-filter-errors@example.com", name: "CF" })
			.returning();
		if (!testUser) {
			throw new Error("failed to seed the content filter error test user");
		}
		await db.insert(organization).values({
			id: "cfe-org",
			name: "CF Org",
			billingEmail: testUser.email,
		});
		await db.insert(project).values({
			id: "cfe-proj",
			name: "CF Project",
			organizationId: "cfe-org",
		});
		await db.insert(apiKey).values({
			id: "cfe-key",
			description: "CF key",
			tokenHash: "cfe-token",
			tokenMasked: "cfe-token",
			projectId: "cfe-proj",
			createdBy: testUser.id,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("counts each stored error once per request and keeps the latest sample", async () => {
		await db.insert(log).values([
			logRow({ gatewayContentFilterEvaluation: evaluation([AVIF]) }),
			logRow({
				requestId: "cfe-req-latest",
				createdAt: LATER_WITHIN_HOUR,
				gatewayContentFilterEvaluation: evaluation([
					{ ...AVIF, message: "Unsupported format: image/avif (later)" },
					TIMEOUT,
				]),
			}),
			// A provider retry copies the evaluation: not counted again.
			logRow({
				requestId: "cfe-req-latest",
				createdAt: LATER_WITHIN_HOUR,
				usedProvider: "azure",
				gatewayContentFilterEvaluation: evaluation([
					{ ...AVIF, message: "Unsupported format: image/avif (later)" },
					TIMEOUT,
				]),
			}),
			// Clean checks and unsampled requests carry nothing.
			logRow({ gatewayContentFilterEvaluation: evaluation(undefined) }),
			logRow(),
			// Outside the hour: ignored.
			logRow({
				createdAt: new Date("2026-08-07T11:05:00.000Z"),
				gatewayContentFilterEvaluation: evaluation([TIMEOUT]),
			}),
		]);

		expect(await calculateContentFilterErrorStatsForHour(HOUR)).toEqual({
			rows: 2,
		});
		expect(await rows()).toEqual([
			{
				hourTimestamp: HOUR,
				organizationId: "cfe-org",
				projectId: "cfe-proj",
				classifier: "internal",
				source: "internal",
				kind: "timeout",
				inputType: "text",
				status: 0,
				code: "",
				errorCount: 1,
				lastMessage: "moderation call timed out",
				lastRequestId: "cfe-req-latest",
				lastSeenAt: LATER_WITHIN_HOUR,
			},
			{
				hourTimestamp: HOUR,
				organizationId: "cfe-org",
				projectId: "cfe-proj",
				classifier: "internal",
				source: "openai",
				kind: "upstream_4xx",
				inputType: "image",
				status: 400,
				code: "invalid_image_format",
				errorCount: 2,
				lastMessage: "Unsupported format: image/avif (later)",
				lastRequestId: "cfe-req-latest",
				lastSeenAt: LATER_WITHIN_HOUR,
			},
		]);
	});

	it("replaces the hour on recount", async () => {
		await db
			.insert(log)
			.values([logRow({ gatewayContentFilterEvaluation: evaluation([AVIF]) })]);
		await calculateContentFilterErrorStatsForHour(HOUR);
		expect(await rows()).toHaveLength(1);

		await db.delete(log);
		await db
			.insert(log)
			.values([
				logRow({ gatewayContentFilterEvaluation: evaluation([TIMEOUT]) }),
			]);
		await calculateContentFilterErrorStatsForHour(HOUR);
		expect((await rows()).map((row) => row.kind)).toEqual(["timeout"]);
	});
});
