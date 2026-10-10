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
import {
	evaluatePromptCache,
	processPromptCacheAlerts,
	renderPromptCacheAlert,
	type KeyModelCacheUsage,
	type PromptCacheFinding,
	type ProviderCacheUsage,
} from "./prompt-cache-alerts.js";

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

function providerUsage(
	overrides: Partial<ProviderCacheUsage> = {},
): ProviderCacheUsage {
	return {
		providerId: "anthropic",
		region: null,
		requests: 100,
		inputTokens: new Decimal(1_000_000),
		cachedTokens: new Decimal(0),
		cacheWriteTokens: new Decimal(0),
		uncachedInputCost: new Decimal(20),
		inputPrice: new Decimal("0.000003"),
		cachedInputPrice: new Decimal("0.0000003"),
		minCacheableTokens: null,
		autoModeEnablesCaching: true,
		...overrides,
	};
}

function keyModelUsage(
	overrides: Partial<KeyModelCacheUsage> = {},
): KeyModelCacheUsage {
	return {
		apiKeyId: "key-1",
		apiKeyDescription: "Production key",
		projectId: "project-1",
		organizationId: "org-1",
		organizationKind: "default",
		modelId: "example-model",
		cacheMode: "auto",
		providers: [providerUsage()],
		...overrides,
	};
}

function summary(finding: PromptCacheFinding | null) {
	return (
		finding && {
			providerIds: finding.providerIds,
			requests: finding.requests,
			hitRate: finding.hitRate.toString(),
			uncachedInputCost: finding.uncachedInputCost.toString(),
			potentialSavings: finding.potentialSavings.toString(),
			cause: finding.cause,
		}
	);
}

function evaluate(overrides: Partial<KeyModelCacheUsage> = {}) {
	return summary(evaluatePromptCache(keyModelUsage(overrides)));
}

describe("evaluatePromptCache", () => {
	it("flags a key and model under 50% with at least $5 of savings", () => {
		expect(
			evaluate({
				providers: [providerUsage({ cachedTokens: new Decimal(100_000) })],
			}),
		).toEqual({
			providerIds: ["anthropic"],
			requests: 100,
			hitRate: "0.1",
			uncachedInputCost: "20",
			potentialSavings: "18",
			cause: "cache_not_reused",
		});
	});

	it("does not flag at exactly 50%; flags just below", () => {
		expect(
			evaluate({
				providers: [providerUsage({ cachedTokens: new Decimal(500_000) })],
			}),
			"at 50%",
		).toBeNull();
		expect(
			evaluate({
				providers: [providerUsage({ cachedTokens: new Decimal(499_999) })],
			})?.hitRate,
			"just below 50%",
		).toBe("0.499999");
	});

	it("flags at exactly $5.00 of savings; not at $4.99", () => {
		const halfPrice = {
			inputPrice: new Decimal(2),
			cachedInputPrice: new Decimal(1),
		};
		expect(
			evaluate({
				providers: [
					providerUsage({ ...halfPrice, uncachedInputCost: new Decimal(10) }),
				],
			})?.potentialSavings,
			"$5.00",
		).toBe("5");
		expect(
			evaluate({
				providers: [
					providerUsage({
						...halfPrice,
						uncachedInputCost: new Decimal("9.98"),
					}),
				],
			}),
			"$4.99",
		).toBeNull();
	});

	it("never flags a mapping without a cached input price", () => {
		expect(
			evaluate({
				providers: [
					providerUsage({
						cachedInputPrice: null,
						uncachedInputCost: new Decimal(100),
					}),
				],
			}),
			"no cached price",
		).toBeNull();
		expect(
			evaluate({
				providers: [
					providerUsage({
						inputPrice: null,
						cachedInputPrice: null,
						uncachedInputCost: new Decimal(100),
					}),
				],
			}),
			"no mapping",
		).toBeNull();
	});

	it("never flags when the cached price is not cheaper or input is free", () => {
		const prices: Array<[string, string, string]> = [
			["equal", "0.000003", "0.000003"],
			["dearer", "0.000003", "0.000004"],
			["free input", "0", "0"],
		];
		for (const [name, inputPrice, cachedInputPrice] of prices) {
			expect(
				evaluate({
					providers: [
						providerUsage({
							inputPrice: new Decimal(inputPrice),
							cachedInputPrice: new Decimal(cachedInputPrice),
							uncachedInputCost: new Decimal(100),
						}),
					],
				}),
				name,
			).toBeNull();
		}
	});

	it("leaves providers without a cache out of the hit rate", () => {
		const noCache = providerUsage({
			providerId: "google-ai-studio",
			inputTokens: new Decimal(10_000_000),
			uncachedInputCost: new Decimal(200),
			cachedInputPrice: null,
		});
		expect(
			evaluate({
				providers: [
					providerUsage({ cachedTokens: new Decimal(800_000) }),
					noCache,
				],
			}),
			"80% on the cached provider",
		).toBeNull();
		expect(
			evaluate({
				providers: [
					providerUsage({ cachedTokens: new Decimal(100_000) }),
					noCache,
				],
			}),
			"10% on the cached provider",
		).toEqual({
			providerIds: ["anthropic"],
			requests: 100,
			hitRate: "0.1",
			uncachedInputCost: "20",
			potentialSavings: "18",
			cause: "cache_not_reused",
		});
	});

	it("applies each provider's own cached/input ratio", () => {
		expect(
			evaluate({
				providers: [
					providerUsage({ uncachedInputCost: new Decimal(10) }),
					providerUsage({
						providerId: "aws-bedrock",
						uncachedInputCost: new Decimal(10),
						inputPrice: new Decimal("0.000003"),
						cachedInputPrice: new Decimal("0.0000015"),
					}),
				],
			})?.potentialSavings,
		).toBe("14");
	});

	it("skips projects whose effective mode is off", () => {
		expect(evaluate({ cacheMode: "off" })).toBeNull();
	});

	it("requires 20 successful requests", () => {
		expect(
			evaluate({ providers: [providerUsage({ requests: 19 })] }),
		).toBeNull();
		expect(
			evaluate({
				providers: [
					providerUsage({ requests: 10 }),
					providerUsage({ providerId: "aws-bedrock", requests: 10 }),
				],
			})?.requests,
		).toBe(20);
	});

	it("skips providers whose mean prompt is below the minimum cacheable size", () => {
		expect(
			evaluate({
				providers: [providerUsage({ inputTokens: new Decimal(50_000) })],
			}),
			"500 tokens against the 1024 default",
		).toBeNull();
		expect(
			evaluate({
				providers: [providerUsage({ inputTokens: new Decimal(200_000) })],
			}),
			"2000 tokens against the 1024 default",
		).not.toBeNull();
		expect(
			evaluate({
				providers: [
					providerUsage({
						inputTokens: new Decimal(200_000),
						minCacheableTokens: 4096,
					}),
				],
			}),
			"2000 tokens against a 4096 mapping minimum",
		).toBeNull();
	});

	it("names Client-managed only when every provider gains caching in Automatic and nothing was read or written", () => {
		const passthrough = { cacheMode: "passthrough" as const };
		expect(evaluate(passthrough)?.cause, "marker provider").toBe(
			"client_managed_without_markers",
		);
		expect(
			evaluate({
				...passthrough,
				providers: [providerUsage({ cacheWriteTokens: new Decimal(1) })],
			})?.cause,
			"one cache write",
		).toBe("cache_not_reused");
		expect(
			evaluate({
				...passthrough,
				providers: [providerUsage({ cachedTokens: new Decimal(1) })],
			})?.cause,
			"one cache read",
		).toBe("cache_not_reused");
		expect(
			evaluate({
				...passthrough,
				providers: [providerUsage({ autoModeEnablesCaching: false })],
			})?.cause,
			"implicit-cache provider",
		).toBe("cache_not_reused");
		expect(
			evaluate({
				...passthrough,
				providers: [
					providerUsage(),
					providerUsage({
						providerId: "openai",
						autoModeEnablesCaching: false,
					}),
				],
			})?.cause,
			"mixed providers",
		).toBe("cache_not_reused");
		expect(evaluate({ cacheMode: "auto" })?.cause, "Automatic").toBe(
			"cache_not_reused",
		);
		expect(
			evaluate({ ...passthrough, organizationKind: "devpass" })?.cause,
			"DevPass org",
		).toBe("cache_not_reused");
	});
});

describe("renderPromptCacheAlert", () => {
	const finding: PromptCacheFinding = {
		apiKeyId: "key-1",
		apiKeyDescription: "Production key",
		projectId: "project-1",
		organizationId: "org-1",
		modelId: "example-model",
		providerIds: ["anthropic"],
		requests: 100,
		hitRate: new Decimal("0.129"),
		uncachedInputCost: new Decimal(20),
		potentialSavings: new Decimal("18.456"),
		cause: "cache_not_reused",
	};

	it("states the floored cache share, saying none only when nothing was read", () => {
		expect(renderPromptCacheAlert(finding)).toEqual({
			title: "Prompt cache misses on example-model",
			message:
				"API key Production key: only 12% of input tokens sent to example-model in the last 24 hours were read from the provider's prompt cache. Reusing the cache could have saved up to $18.46. Keep the start of each prompt identical between follow-up requests so the provider can reuse it.",
			href: "/features/caching/provider-cache-control",
		});
		const shares: Array<[string, string]> = [
			["0", "none of the input tokens sent"],
			["0.004", "under 1% of input tokens sent"],
			["0.01", "only 1% of input tokens sent"],
		];
		for (const [hitRate, share] of shares) {
			expect(
				renderPromptCacheAlert({ ...finding, hitRate: new Decimal(hitRate) })
					.message,
				hitRate,
			).toContain(`API key Production key: ${share} to example-model`);
		}
	});

	it("advises Automatic for Client-managed projects only when requests share a start", () => {
		expect(
			renderPromptCacheAlert({
				...finding,
				hitRate: new Decimal(0),
				cause: "client_managed_without_markers",
			}),
		).toEqual({
			title: "Prompt cache unused on example-model",
			message:
				"API key Production key: no input sent to example-model in the last 24 hours was read from or written to the provider's prompt cache. The project uses Client-managed caching and the requests carry no cache markers. If they start with the same instructions, tools or conversation, switching the project to Automatic caches that shared start and could have saved up to $18.46. One-off prompts won't benefit.",
			href: "/dashboard/org-1/project-1/settings/preferences",
		});
	});
});

describe("processPromptCacheAlerts", () => {
	const windowEnd = new Date(Math.floor(Date.now() / HOUR) * HOUR);
	const now = afterWindowEnd(duration(0, 0, 7));
	const info = vi.spyOn(logger, "info");
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

	async function insertUsage(
		values: Partial<typeof tables.apiKeyHourlyModelStats.$inferInsert> = {},
	) {
		await db.insert(tables.apiKeyHourlyModelStats).values({
			projectId: "cache-project",
			apiKeyId: "cache-key",
			usedModel: "anthropic/cache-model",
			usedProvider: "anthropic",
			hourTimestamp: new Date(windowEnd.getTime() - HOUR),
			requestCount: 100,
			inputTokens: "1000000",
			inputCost: 20,
			...values,
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

	beforeEach(async () => {
		info.mockClear();
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
		await db.insert(tables.provider).values({
			id: "anthropic",
			name: "Anthropic",
			description: "Anthropic",
		});
		await db.insert(tables.model).values({ id: "cache-model", family: "test" });
		await db.insert(tables.modelProviderMapping).values({
			id: "cache-mapping",
			modelId: "cache-model",
			providerId: "anthropic",
			externalId: "cache-model",
			inputPrice: "0.000003",
			cachedInputPrice: "0.0000003",
		});
	});

	it("skips the usage query and records nothing when nobody opted in", async () => {
		await db.insert(tables.notificationPreference).values({
			userId: "cache-owner",
			type: "prompt_cache",
			inApp: false,
			email: false,
		});
		await insertUsage();
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
		expect(execute, "usage query once a reader exists").toHaveBeenCalledTimes(
			1,
		);
		expect(await alerts(), "next window").toMatchObject([
			{ userId: "cache-owner", apiKeyId: "cache-key" },
		]);
	});

	it("evaluates a window once", async () => {
		await enable();
		await insertUsage();
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

	it("reads only the last 24 completed hours", async () => {
		await enable();
		await insertUsage({
			hourTimestamp: new Date(windowEnd.getTime() - DAY),
			requestCount: 10,
		});
		await insertUsage({
			hourTimestamp: new Date(windowEnd.getTime() - HOUR),
			requestCount: 10,
		});
		await insertUsage({ hourTimestamp: windowEnd, requestCount: 1000 });
		await insertUsage({
			hourTimestamp: new Date(windowEnd.getTime() - DAY - HOUR),
			requestCount: 2000,
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{ message: expect.stringContaining("could have saved up to $36.00.") },
		]);
	});

	it("waits for the settle margin before reading the hour that just closed", async () => {
		await enable();
		await insertUsage({ hourTimestamp: new Date(windowEnd.getTime() - HOUR) });
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
			await insertUsage({ apiKeyId });
		}
		await processPromptCacheAlerts(now);
		expect((await alerts()).map((alert) => alert.apiKeyId)).toEqual([
			"cache-key",
		]);
	});

	it("skips ZDR orgs whose project is still Client-managed", async () => {
		await enable();
		await insertUsage();
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
			{ title: "Prompt cache unused on cache-model" },
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
			inputPrice: "0.000003",
			cachedInputPrice: "0.0000015",
		});
		await insertKey({ id: "cache-key-us" });
		await insertUsage({ usedModel: "anthropic/cache-model:eu" });
		await insertUsage({
			apiKeyId: "cache-key-us",
			usedModel: "anthropic/cache-model:us",
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{
				apiKeyId: "cache-key",
				message: expect.stringContaining("could have saved up to $10.00."),
			},
			{
				apiKeyId: "cache-key-us",
				message: expect.stringContaining("could have saved up to $18.00."),
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
			inputPrice: "0.000003",
			cachedInputPrice: "0.0000003",
		});
		await insertUsage({
			usedModel: "anthropic/claude-sonnet-5",
			inputTokens: "200000",
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

	it("leaves image and audio input spend out of the savings", async () => {
		await enable();
		await insertUsage({ inputCost: 30, imageInputCost: 6, audioInputCost: 4 });
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([
			{ message: expect.stringContaining("could have saved up to $18.00.") },
		]);
	});

	it("does not count errors or response-cache replays toward the request floor", async () => {
		await enable();
		await insertKey({ id: "cache-key-20" });
		await insertUsage({ requestCount: 30, errorCount: 5, cacheCount: 6 });
		await insertUsage({
			apiKeyId: "cache-key-20",
			requestCount: 30,
			errorCount: 5,
			cacheCount: 5,
		});
		await processPromptCacheAlerts(now);
		expect((await alerts()).map((alert) => alert.apiKeyId)).toEqual([
			"cache-key-20",
		]);
	});

	it("two concurrent passes record one notification per reader", async () => {
		await enable();
		await insertUsage();
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
				eventKey: `prompt_cache:cache-key:cache-model:${windowEnd.toISOString()}`,
				title: "Prompt cache misses on cache-model",
				href: "/features/caching/provider-cache-control",
				inApp: true,
				email: false,
			},
		]);
		expect(capture).toHaveBeenCalledTimes(1);
	});

	it("alerts each reader once per key and model per rolling 7 days", async () => {
		await enable();
		await insertUsage();
		await insertUsage({
			hourTimestamp: afterWindowEnd(duration(6, 22)),
		});
		await insertUsage({
			hourTimestamp: afterWindowEnd(duration(7)),
		});
		for (const at of [
			now,
			later(HOUR),
			later(duration(6, 23)),
			later(duration(7, 1)),
		]) {
			await processPromptCacheAlerts(at);
		}
		expect((await alerts()).map((alert) => alert.eventKey).sort()).toEqual([
			`prompt_cache:cache-key:cache-model:${windowEnd.toISOString()}`,
			`prompt_cache:cache-key:cache-model:${afterWindowEnd(duration(7, 1)).toISOString()}`,
		]);
	});

	it("keeps another developer's keys private", async () => {
		await enable("cache-developer");
		await insertUsage();
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
		await insertUsage();
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
			await insertUsage();
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
			await insertUsage();
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
		await insertUsage();
		await processPromptCacheAlerts(now);
		expect(
			await db.query.notification.findMany({ columns: { email: true } }),
		).toEqual([{ email: true }]);
	});

	it("captures prompt_cache_alert_sent once per recorded notification", async () => {
		await enableEmailOnly();
		await insertUsage({ cachedTokens: "100000" });
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
						providers: "anthropic",
						cause: "cache_not_reused",
						hitRatePercent: 10,
						potentialSavings: 18,
						inApp: false,
						email: true,
					},
				},
			],
		]);

		await processPromptCacheAlerts(later(HOUR));
		expect(await alerts(), "skipped by the 7-day lookback").toHaveLength(1);
		expect(capture).toHaveBeenCalledTimes(1);
	});

	it("does not capture when the unique event key, not the 7-day lookback, blocks the insert", async () => {
		const createdBeyondLookback = new Date(now.getTime() - duration(8));
		await enable();
		await insertUsage();
		await db.insert(tables.notification).values({
			userId: "cache-owner",
			type: "prompt_cache",
			apiKeyId: "cache-key",
			projectId: "cache-project",
			eventKey: `prompt_cache:cache-key:cache-model:${windowEnd.toISOString()}`,
			title: "Prompt cache misses on cache-model",
			message: "Earlier alert",
			href: "/features/caching/provider-cache-control",
			inApp: true,
			email: false,
			createdAt: createdBeyondLookback,
		});
		await processPromptCacheAlerts(now);
		expect(await alerts()).toMatchObject([{ message: "Earlier alert" }]);
		expect(capture).not.toHaveBeenCalled();
		expect(summaries()).toMatchObject([{ findings: 1, notifications: 0 }]);
	});
});
