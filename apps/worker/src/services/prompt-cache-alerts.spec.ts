import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import {
	buildUnsubscribeHeaders,
	signUnsubscribeToken,
} from "@llmgateway/shared/email-unsubscribe";

import { processNotifications } from "./notifications.js";
import { processPromptCacheAlerts } from "./prompt-cache-alerts.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@/posthog.js", () => ({ posthog: { capture } }));
const send = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@llmgateway/shared/email", () => ({
	getResendClient: () => ({ emails: { send } }),
	fromEmail: "alerts@example.com",
	replyToEmail: "support@example.com",
}));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function duration(days: number, hours = 0, minutes = 0): number {
	const dayMs = days * DAY;
	const hourMs = hours * HOUR;
	const minuteMs = minutes * MINUTE;
	return dayMs + hourMs + minuteMs;
}

type HourValues = Partial<typeof tables.apiKeyHourlyModelStats.$inferInsert>;

const PRICE = { input: "0.000003", cached: "0.0000003", write: "0.00000375" };

function agentHour(
	hitRate: number,
	writeShare: number,
	writePrice: string | null = PRICE.write,
): HourValues {
	const requests = 60;
	const input = new Decimal(requests).mul(60_000);
	const cached = input.mul(hitRate);
	const writes = input.mul(writeShare);
	const separatelyBilledWrites = writePrice === null ? 0 : writes;
	return {
		requestCount: requests,
		streamedCount: requests,
		toolCallsCount: requests * 0.85,
		inputTokens: input.toString(),
		cachedTokens: cached.toString(),
		cacheWriteTokens: writes.toString(),
		inputCost: input
			.minus(cached)
			.minus(separatelyBilledWrites)
			.mul(PRICE.input)
			.toNumber(),
		cachedInputCost: cached.mul(PRICE.cached).toNumber(),
		cacheWriteInputCost: writes.mul(writePrice ?? 0).toNumber(),
	};
}

const BROKEN = agentHour(0.6, 0.03);
const HEALTHY = agentHour(0.95, 0.04);
const UNMARKED = agentHour(0, 0);

describe("processPromptCacheAlerts", () => {
	const windowEnd = new Date("2026-03-04T12:00:00.000Z");
	const midnight = new Date("2026-03-04T00:00:00.000Z");
	const now = afterWindowEnd(duration(0, 0, 7));
	const info = vi.spyOn(logger, "info");
	const warn = vi.spyOn(logger, "warn");
	const execute = vi.spyOn(db, "execute");

	function alerts() {
		return db.query.notification.findMany({
			columns: {
				userId: true,
				apiKeyId: true,
				eventKey: true,
				title: true,
				message: true,
			},
			orderBy: { apiKeyId: "asc" },
		});
	}

	function summaries() {
		return info.mock.calls
			.filter(([message]) => message === "Prompt cache alerts evaluated")
			.map(([, extra]) => extra);
	}

	function later(ms: number) {
		return new Date(now.getTime() + ms);
	}

	function afterWindowEnd(ms: number) {
		return new Date(windowEnd.getTime() + ms);
	}

	function hourOf(day: number, hour: number) {
		return new Date(midnight.getTime() + duration(day, hour));
	}

	async function insertKey(
		values: Partial<typeof tables.apiKey.$inferInsert> & { id: string },
	) {
		await db.insert(tables.apiKey).values({
			...hashApiKeyForStorage(`token-${values.id}`),
			description: "Production key",
			projectId: "cache-project",
			createdBy: "cache-owner",
			...values,
		});
	}

	function hourRow(hourTimestamp: Date, values: HourValues = {}) {
		return {
			projectId: "cache-project",
			apiKeyId: "cache-key",
			usedModel: "anthropic/cache-model",
			usedProvider: "anthropic",
			hourTimestamp,
			...BROKEN,
			...values,
		};
	}

	async function insertAgent(
		values: HourValues = {},
		days = [-1, 0],
		until = windowEnd,
	) {
		const rows = days.flatMap((day) =>
			Array.from({ length: 9 }, (_, i) => hourOf(day, 9 + i))
				.filter((hour) => hour < until)
				.map((hour) => hourRow(hour, values)),
		);
		await db.insert(tables.apiKeyHourlyModelStats).values(rows);
	}

	async function insertAlert(eventKey: string, createdAt: Date) {
		await db.insert(tables.notification).values({
			userId: "cache-owner",
			type: "prompt_cache",
			apiKeyId: "cache-key",
			projectId: "cache-project",
			eventKey,
			title: "Earlier alert",
			message: "Earlier alert",
			href: "/features/caching/provider-cache-control",
			inApp: true,
			email: false,
			createdAt,
		});
	}

	async function enable(userId = "cache-owner", email = false) {
		await db
			.insert(tables.notificationPreference)
			.values({ userId, type: "prompt_cache", inApp: true, email });
	}

	async function enableEmailOnly() {
		await db.insert(tables.notificationPreference).values({
			userId: "cache-owner",
			type: "prompt_cache",
			inApp: false,
			email: true,
		});
	}

	async function unsubscribeOwner(
		category: typeof tables.emailUnsubscribe.$inferInsert.category,
	) {
		await db
			.insert(tables.emailUnsubscribe)
			.values({ email: "owner@example.com", category, source: "one_click" });
	}

	const blockedOwnerEmails: Array<[string, () => Promise<void>]> = [
		[
			"unsubscribed from prompt cache alerts",
			() => unsubscribeOwner("prompt_cache"),
		],
		[
			"unverified",
			async () => {
				await db
					.update(tables.user)
					.set({ emailVerified: false })
					.where(eq(tables.user.id, "cache-owner"));
			},
		],
	];

	const brokenMessage =
		"API key Production key, cache-model via Anthropic: on its last full day of use, at least 85% of responses ended in streamed tool calls, yet only 60% of input tokens were read from the prompt cache. Today's traffic so far shows the same pattern. If those tool results go back with the conversation so far, check that instructions, tools and earlier messages keep an identical prefix. A change such as a timestamp makes the rest of the prompt a miss. A stable prefix could save an estimated $21.87 a day, less if each turn adds a large new tool result.";

	beforeEach(async () => {
		info.mockClear();
		warn.mockClear();
		execute.mockClear();
		capture.mockReset();
		send.mockReset().mockResolvedValue({ error: null });
		await redisClient.flushdb();
		await db.delete(tables.notification);
		await db.delete(tables.notificationPreference);
		await db.delete(tables.emailUnsubscribe);
		await db.delete(tables.apiKeyHourlyModelStats);
		await db.delete(tables.project);
		await db.delete(tables.userOrganization);
		await db.delete(tables.organization);
		await db.delete(tables.user);
		await db.delete(tables.modelProviderMapping);
		await db.delete(tables.model);
		await db.delete(tables.provider);
		await db.insert(tables.user).values([
			{ id: "cache-owner", email: "owner@example.com", emailVerified: true },
			{
				id: "cache-developer",
				email: "developer@example.com",
				emailVerified: true,
			},
		]);
		await db.insert(tables.organization).values({
			id: "cache-org",
			name: "Test Organization",
			billingEmail: "owner@example.com",
		});
		await db.insert(tables.userOrganization).values([
			{
				id: "cache-owner-member",
				userId: "cache-owner",
				organizationId: "cache-org",
				role: "owner",
			},
			{
				id: "cache-developer-member",
				userId: "cache-developer",
				organizationId: "cache-org",
				role: "developer",
			},
		]);
		await db.insert(tables.project).values({
			id: "cache-project",
			organizationId: "cache-org",
			name: "Test Project",
		});
		await db.insert(tables.userProject).values({
			userOrganizationId: "cache-developer-member",
			projectId: "cache-project",
		});
		await insertKey({ id: "cache-key" });
		await db.insert(tables.provider).values([
			{ id: "anthropic", name: "Anthropic", description: "Anthropic" },
			{ id: "aws-bedrock", name: "AWS Bedrock", description: "AWS Bedrock" },
		]);
		await db.insert(tables.model).values({ id: "cache-model", family: "test" });
		await db.insert(tables.modelProviderMapping).values({
			id: "cache-mapping",
			modelId: "cache-model",
			providerId: "anthropic",
			externalId: "cache-model",
			inputPrice: PRICE.input,
			cachedInputPrice: PRICE.cached,
			cacheWriteInputPrice: PRICE.write,
		});
	});

	it("skips the usage queries and records nothing when nobody opted in", async () => {
		await db.insert(tables.notificationPreference).values({
			userId: "cache-owner",
			type: "prompt_cache",
			inApp: false,
			email: false,
		});
		await insertAgent();
		await processPromptCacheAlerts(now);
		expect(execute, "no usage query").not.toHaveBeenCalled();
		expect(await alerts()).toEqual([]);
		expect(summaries()).toEqual([
			{
				windowEnd: windowEnd.toISOString(),
				groups: 0,
				findings: 0,
				notifications: 0,
				durationMs: expect.any(Number),
			},
		]);

		await db.delete(tables.notificationPreference);
		await enable();
		await processPromptCacheAlerts(later(30 * MINUTE));
		expect(await alerts(), "window already evaluated").toEqual([]);
		await processPromptCacheAlerts(later(HOUR));
		expect(
			execute,
			"candidate scan and history load once a reader exists",
		).toHaveBeenCalledTimes(2);
		expect(await alerts(), "next window").toMatchObject([
			{ userId: "cache-owner", apiKeyId: "cache-key" },
		]);
	});

	it("evaluates a window once", async () => {
		await enable();
		await insertAgent();
		await processPromptCacheAlerts(now);
		expect(summaries()).toEqual([
			{
				windowEnd: windowEnd.toISOString(),
				groups: 1,
				findings: 1,
				notifications: 1,
				durationMs: expect.any(Number),
			},
		]);
		await db.delete(tables.notification);
		await processPromptCacheAlerts(later(30 * MINUTE));
		expect(await alerts(), "no second notification").toEqual([]);
		expect(summaries(), "one evaluation summary").toHaveLength(1);
	});

	it("tells a coding agent stuck at 60% on its second day, and not on its first", async () => {
		await enable();
		await insertAgent({}, [0]);
		await processPromptCacheAlerts(now);
		expect(await alerts(), "one day of use").toEqual([]);

		await redisClient.flushdb();
		await insertAgent({}, [-1]);
		await processPromptCacheAlerts(now);
		expect(await alerts()).toEqual([
			{
				userId: "cache-owner",
				apiKeyId: "cache-key",
				eventKey: "prompt_cache:cache-key:cache-model:cache_broken:1",
				title: "Prompt cache misses on cache-model",
				message: brokenMessage,
			},
		]);
	});

	it("tells a weekly key on its second week, from the whole previous day", async () => {
		await enable();
		await insertAgent({}, [-7, 0]);
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([{ message: brokenMessage }]);
	});

	it("sums every used_model string of a stream per hour before bounding follow-ups", async () => {
		await enable();
		const half = {
			requestCount: 30,
			inputTokens: "1800000",
			cachedTokens: "180000",
			cacheWriteTokens: "54000",
			inputCost: 4.698,
			cachedInputCost: 0.054,
			cacheWriteInputCost: 0.2025,
		};
		await insertAgent({ ...half, streamedCount: 30, toolCallsCount: 30 });
		await insertAgent({
			...half,
			usedModel: "custom/cache-model",
			streamedCount: 0,
			toolCallsCount: 21,
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{
				message: expect.stringContaining(
					"at least 35% of responses ended in streamed tool calls, yet only 10% of input tokens",
				),
			},
		]);
	});

	it("waits for the settle margin before reading the hour that just closed", async () => {
		await enable();
		await insertAgent();
		await processPromptCacheAlerts(afterWindowEnd(duration(0, 0, 3)));
		expect(await alerts(), "hour still settling").toEqual([]);
		await processPromptCacheAlerts(now);
		expect(await alerts(), "hour settled").toHaveLength(1);
	});

	it("ignores playground, end-user, expired and inactive keys", async () => {
		await enable();
		await insertKey({ id: "cache-playground", kind: "playground" });
		await insertKey({ id: "cache-end-user", keyType: "end_user_customer" });
		await insertKey({
			id: "cache-expired",
			expiresAt: new Date(windowEnd.getTime() - MINUTE),
		});
		await insertKey({ id: "cache-inactive", status: "inactive" });
		for (const apiKeyId of [
			"cache-key",
			"cache-playground",
			"cache-end-user",
			"cache-expired",
			"cache-inactive",
		]) {
			await insertAgent({ apiKeyId });
		}
		await processPromptCacheAlerts(now);
		expect((await alerts()).map((alert) => alert.apiKeyId)).toEqual([
			"cache-key",
		]);
	});

	it("skips ZDR orgs whose project is still Client-managed", async () => {
		await enable();
		await insertAgent(UNMARKED);
		await db
			.update(tables.project)
			.set({ providerCacheControlMode: "passthrough" });
		await db.update(tables.organization).set({
			providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
		});
		await processPromptCacheAlerts(now);
		expect(await alerts(), "under ZDR").toEqual([]);

		await redisClient.flushdb();
		await db
			.update(tables.organization)
			.set({ providerCompliancePolicy: null });
		await processPromptCacheAlerts(now);
		expect(await alerts(), "without ZDR").toMatchObject([
			{
				eventKey: "prompt_cache:cache-key:cache-model:switch_to_automatic",
				title: "Prompt cache unused on cache-model",
			},
		]);
	});

	function silentWarnings() {
		return warn.mock.calls.filter(
			([message]) => message === "Automatic caching produced no cache activity",
		);
	}

	it("warns ops, not users, when Automatic caching shows no cache activity", async () => {
		await enable();
		await insertAgent(UNMARKED);
		await processPromptCacheAlerts(now);
		expect(await alerts()).toEqual([]);
		expect(silentWarnings()).toEqual([
			[
				"Automatic caching produced no cache activity",
				{
					count: 1,
					samples: [
						{
							apiKeyId: "cache-key",
							modelId: "cache-model",
							providerId: "anthropic",
							region: null,
						},
					],
				},
			],
		]);
	});

	it("warns ops once per pass however many streams are silent", async () => {
		await enable();
		const apiKeyIds = Array.from({ length: 6 }, (_, i) => `cache-key-${i}`);
		for (const apiKeyId of apiKeyIds) {
			await insertKey({ id: apiKeyId });
			await insertAgent({ ...UNMARKED, apiKeyId });
		}
		await processPromptCacheAlerts(now);
		expect(silentWarnings()).toEqual([
			[
				"Automatic caching produced no cache activity",
				{
					count: 6,
					samples: Array.from({ length: 5 }, () =>
						expect.objectContaining({ modelId: "cache-model" }),
					),
				},
			],
		]);
	});

	it("prices regional usage with the regional mapping row, and falls back to the base row when none matches", async () => {
		await enable();
		await db.insert(tables.modelProviderMapping).values({
			id: "cache-mapping-eu",
			modelId: "cache-model",
			providerId: "anthropic",
			externalId: "cache-model",
			region: "eu",
			inputPrice: PRICE.input,
			cachedInputPrice: "0.0000006",
			cacheWriteInputPrice: PRICE.write,
		});
		await insertKey({ id: "cache-key-us" });
		await insertAgent({ usedModel: "anthropic/cache-model:eu" });
		await insertAgent({
			apiKeyId: "cache-key-us",
			usedModel: "anthropic/cache-model:us",
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{
				apiKeyId: "cache-key",
				message: expect.stringContaining("an estimated $19.44 a day"),
			},
			{
				apiKeyId: "cache-key-us",
				message: expect.stringContaining("an estimated $21.87 a day"),
			},
		]);
	});

	it("uses the catalogue's minimum cacheable size when the mapping row has none", async () => {
		await enable();
		await db
			.insert(tables.model)
			.values({ id: "claude-sonnet-5", family: "test" });
		await db.insert(tables.modelProviderMapping).values({
			id: "cache-mapping-sonnet",
			modelId: "claude-sonnet-5",
			providerId: "anthropic",
			externalId: "claude-sonnet-5",
			inputPrice: PRICE.input,
			cachedInputPrice: PRICE.cached,
			cacheWriteInputPrice: PRICE.write,
		});
		await insertAgent({
			usedModel: "anthropic/claude-sonnet-5",
			requestCount: 1800,
			streamedCount: 1800,
			toolCallsCount: 1530,
		});
		await processPromptCacheAlerts(now);
		expect(
			await alerts(),
			"2000-token prompts against the catalogue's 4096",
		).toEqual([]);

		await redisClient.flushdb();
		await db
			.update(tables.modelProviderMapping)
			.set({ minCacheableTokens: 1024 })
			.where(eq(tables.modelProviderMapping.id, "cache-mapping-sonnet"));
		await processPromptCacheAlerts(now);
		expect(
			await alerts(),
			"2000-token prompts against the row's own 1024",
		).toMatchObject([{ title: "Prompt cache misses on claude-sonnet-5" }]);
	});

	it("leaves a little image and audio input out of the billed input rate, and skips days with more", async () => {
		await enable();
		await insertKey({ id: "cache-key-media" });
		await insertAgent({
			inputCost: 4.146,
			imageInputCost: 0.1,
			audioInputCost: 0.05,
		});
		await insertAgent({
			apiKeyId: "cache-key-media",
			inputCost: 13.996,
			imageInputCost: 6,
			audioInputCost: 4,
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{ apiKeyId: "cache-key", message: brokenMessage },
		]);
	});

	it("prices write tokens as input when the mapping has no cache write price", async () => {
		await enable();
		await db
			.update(tables.modelProviderMapping)
			.set({ cacheWriteInputPrice: null });
		await insertAgent(agentHour(0.6, 0.03, null));
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([{ message: brokenMessage }]);
	});

	it("alerts a broken agent whose cache writes cost less than input, though under $5 was billed in the window", async () => {
		await enable();
		const cheapWrite = "0.0000003";
		await db
			.update(tables.modelProviderMapping)
			.set({ cacheWriteInputPrice: cheapWrite });
		await insertAgent(agentHour(0.6, 0.35, cheapWrite), [-2, 0]);
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([{ message: brokenMessage }]);
	});

	it("does not count errors or response-cache replays toward the request floor", async () => {
		await enable();
		await insertKey({ id: "cache-key-20" });
		async function insertSessions(apiKeyId: string, errors: number) {
			const rows = [-1, 0].flatMap((day) =>
				[9, 10, 11].map((hour) =>
					hourRow(hourOf(day, hour), {
						apiKeyId,
						inputTokens: "1000000",
						cachedTokens: "0",
						cacheWriteTokens: "50000",
						inputCost: 2.85,
						cachedInputCost: 0,
						cacheWriteInputCost: 0.1875,
						...(hour === 9
							? {
									requestCount: 8,
									errorCount: errors,
									cacheCount: 1,
									streamedCount: 8,
									toolCallsCount: 8 - errors,
								}
							: { requestCount: 7, streamedCount: 7, toolCallsCount: 7 }),
					}),
				),
			);
			await db.insert(tables.apiKeyHourlyModelStats).values(rows);
		}
		await insertSessions("cache-key", 2);
		await insertSessions("cache-key-20", 1);
		await processPromptCacheAlerts(now);
		expect((await alerts()).map((alert) => alert.apiKeyId)).toEqual([
			"cache-key-20",
		]);
	});

	it("reports the provider with the larger estimate when two break on one key and model", async () => {
		await enable();
		await db.insert(tables.modelProviderMapping).values({
			id: "cache-mapping-bedrock",
			modelId: "cache-model",
			providerId: "aws-bedrock",
			externalId: "cache-model",
			inputPrice: PRICE.input,
			cachedInputPrice: PRICE.cached,
			cacheWriteInputPrice: PRICE.write,
		});
		await insertAgent();
		await insertAgent({
			usedModel: "aws-bedrock/cache-model",
			usedProvider: "aws-bedrock",
			cachedTokens: "1080000",
			inputCost: 7.236,
			cachedInputCost: 0.324,
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{
				message: expect.stringContaining(
					"cache-model via AWS Bedrock: on its last full day of use, at least 85% of responses ended in streamed tool calls, yet only 30% of input tokens",
				),
			},
		]);
	});

	it("two concurrent passes record one notification and one capture per reader", async () => {
		await enable();
		await insertAgent();
		await Promise.all([
			processPromptCacheAlerts(now),
			processPromptCacheAlerts(now),
		]);
		expect(await db.query.notification.findMany()).toMatchObject([
			{
				userId: "cache-owner",
				type: "prompt_cache",
				apiKeyId: "cache-key",
				projectId: "cache-project",
				eventKey: "prompt_cache:cache-key:cache-model:cache_broken:1",
				title: "Prompt cache misses on cache-model",
				href: "/features/caching/provider-cache-control",
				inApp: true,
				email: false,
			},
		]);
		expect(capture).toHaveBeenCalledTimes(1);
	});

	it("does not capture when the event key already exists", async () => {
		await enable();
		await insertAgent();
		await insertKey({ id: "cache-key-other" });
		await insertAlert(
			"prompt_cache:cache-key:cache-model:cache_broken:1",
			new Date(windowEnd.getTime() - DAY),
		);
		await db.update(tables.notification).set({ apiKeyId: "cache-key-other" });
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([{ message: "Earlier alert" }]);
		expect(capture).not.toHaveBeenCalled();
		expect(summaries()).toMatchObject([{ findings: 1, notifications: 0 }]);
	});

	it("gives configuration advice once per reader, key and model", async () => {
		await enable();
		const batch = Array.from({ length: 36 }, (_, i) =>
			hourRow(hourOf(-1, i), {
				requestCount: 200,
				streamedCount: 0,
				toolCallsCount: 0,
				inputTokens: "800000",
				cachedTokens: "0",
				cacheWriteTokens: "760000",
				inputCost: 0.12,
				cachedInputCost: 0,
				cacheWriteInputCost: 2.85,
			}),
		);
		await db.insert(tables.apiKeyHourlyModelStats).values(batch);
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{
				eventKey: "prompt_cache:cache-key:cache-model:writes_unused",
				title: "Prompt cache costs more than it saves on cache-model",
			},
		]);

		await db
			.update(tables.notification)
			.set({ createdAt: new Date(windowEnd.getTime() - duration(30)) });
		await redisClient.flushdb();
		await processPromptCacheAlerts(now);
		expect(await alerts(), "30 days later").toHaveLength(1);
	});

	it("holds a reader's alerts for one key and model at least 14 days apart", async () => {
		await enable();
		await insertAgent();
		await insertAlert(
			"prompt_cache:cache-key:cache-model:writes_unused",
			new Date(windowEnd.getTime() - duration(13, 23)),
		);
		await processPromptCacheAlerts(now);
		expect(await alerts(), "13 days 23 hours").toHaveLength(1);

		await db
			.update(tables.notification)
			.set({ createdAt: new Date(windowEnd.getTime() - duration(14)) });
		await redisClient.flushdb();
		await processPromptCacheAlerts(now);
		expect(
			(await alerts()).map((alert) => alert.eventKey).sort(),
			"14 days",
		).toEqual([
			"prompt_cache:cache-key:cache-model:cache_broken:1",
			"prompt_cache:cache-key:cache-model:writes_unused",
		]);
	});

	it("counts an alert from the previous rule toward the 14-day gap, but not as an episode", async () => {
		await enable();
		await insertAgent();
		const legacy =
			"prompt_cache:cache-key:cache-model:2026-03-01T12:00:00.000Z";
		await insertAlert(legacy, new Date(windowEnd.getTime() - duration(3)));
		await processPromptCacheAlerts(now);
		expect(
			(await alerts()).map((alert) => alert.eventKey),
			"3 days later",
		).toEqual([legacy]);

		await db
			.update(tables.notification)
			.set({ createdAt: new Date(windowEnd.getTime() - duration(14)) });
		await redisClient.flushdb();
		await processPromptCacheAlerts(now);
		expect(
			(await alerts()).map((alert) => alert.eventKey).sort(),
			"14 days later",
		).toEqual([legacy, "prompt_cache:cache-key:cache-model:cache_broken:1"]);
	});

	it("re-arms a broken cache only on a complete healthy day between the last alert and the reported day", async () => {
		await enable();
		await insertAgent();
		await insertAlert(
			"prompt_cache:cache-key:cache-model:cache_broken:1",
			new Date(windowEnd.getTime() - duration(20)),
		);
		await insertAgent(HEALTHY, [-21]);
		await processPromptCacheAlerts(now);
		expect(await alerts(), "healthy day before the alert").toHaveLength(1);

		await db
			.insert(tables.apiKeyHourlyModelStats)
			.values(
				[12, 13, 14, 15, 16, 17].map((hour) =>
					hourRow(hourOf(-20, hour), HEALTHY),
				),
			);
		await redisClient.flushdb();
		await processPromptCacheAlerts(now);
		expect(
			await alerts(),
			"healthy afternoon after the alert on its day",
		).toHaveLength(1);

		await insertAgent(HEALTHY, [-15]);
		await redisClient.flushdb();
		await processPromptCacheAlerts(now);
		expect(
			(await alerts()).map((alert) => alert.eventKey).sort(),
			"healthy day between the alert and the reported day",
		).toEqual([
			"prompt_cache:cache-key:cache-model:cache_broken:1",
			"prompt_cache:cache-key:cache-model:cache_broken:2",
		]);
	});

	it("keeps another developer's keys private", async () => {
		await enable("cache-developer");
		await insertAgent();
		await processPromptCacheAlerts(now);
		expect(await alerts(), "key created by the owner").toEqual([]);

		await redisClient.flushdb();
		await db
			.update(tables.apiKey)
			.set({ createdBy: "cache-developer" })
			.where(eq(tables.apiKey.id, "cache-key"));
		await processPromptCacheAlerts(now);
		expect(await alerts(), "key created by the developer").toMatchObject([
			{ userId: "cache-developer" },
		]);
	});

	it("emails opted-in readers with prompt cache unsubscribe headers", async () => {
		await enable("cache-owner", true);
		await insertAgent();
		await processNotifications(now);
		expect(send).toHaveBeenCalledTimes(1);
		const payload = send.mock.calls[0][0];
		expect(payload.to).toBe("owner@example.com");
		expect(payload.subject).toBe("Prompt cache misses on cache-model");
		expect(payload.headers).toEqual(
			buildUnsubscribeHeaders(
				signUnsubscribeToken({
					email: "owner@example.com",
					category: "prompt_cache",
				}),
			),
		);
	});

	it.each(blockedOwnerEmails)(
		"drops an email-only reader whose address is %s",
		async (_, blockEmail) => {
			await enableEmailOnly();
			await blockEmail();
			await insertAgent();
			await processPromptCacheAlerts(now);
			expect(execute, "no usage query").not.toHaveBeenCalled();
			expect(await alerts()).toEqual([]);
			expect(capture).not.toHaveBeenCalled();
		},
	);

	it.each(blockedOwnerEmails)(
		"records and captures in-app only for an in-app and email reader whose address is %s",
		async (_, blockEmail) => {
			await enable("cache-owner", true);
			await blockEmail();
			await insertAgent();
			await processPromptCacheAlerts(now);
			expect(
				await db.query.notification.findMany({
					columns: { userId: true, inApp: true, email: true },
				}),
			).toEqual([{ userId: "cache-owner", inApp: true, email: false }]);
			expect(capture).toHaveBeenCalledTimes(1);
			expect(capture).toHaveBeenCalledWith(
				expect.objectContaining({
					properties: expect.objectContaining({ inApp: true, email: false }),
				}),
			);
		},
	);

	it("keeps email for an address unsubscribed only from another category", async () => {
		await enableEmailOnly();
		await unsubscribeOwner("budget");
		await insertAgent();
		await processPromptCacheAlerts(now);
		expect(
			await db.query.notification.findMany({ columns: { email: true } }),
		).toEqual([{ email: true }]);
	});

	it("captures prompt_cache_alert_sent once per recorded notification", async () => {
		await enableEmailOnly();
		await insertAgent();
		await processPromptCacheAlerts(now);
		expect(capture.mock.calls).toEqual([
			[
				{
					distinctId: "cache-owner",
					event: "prompt_cache_alert_sent",
					groups: { organization: "cache-org" },
					properties: {
						organization: "cache-org",
						projectId: "cache-project",
						apiKeyId: "cache-key",
						modelId: "cache-model",
						providerId: "anthropic",
						cause: "cache_broken",
						followUpPercent: 85,
						hitRatePercent: 60,
						estimatedDailyUsd: 21.87,
						inApp: false,
						email: true,
					},
				},
			],
		]);

		await processPromptCacheAlerts(later(HOUR));
		expect(await alerts(), "same episode an hour later").toHaveLength(1);
		expect(capture).toHaveBeenCalledTimes(1);
	});
});
