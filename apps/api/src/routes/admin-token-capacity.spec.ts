import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, inArray, tables } from "@llmgateway/db";

const MODELS = ["capacity-a", "capacity-b"];
const NOW = new Date("2026-10-08T12:34:30Z");

interface Metrics {
	totalTokens: number;
	avgTpm: number;
	peakTpm: number;
	peakMinuteAt: string | null;
	avgTokensPerDay: number;
	peakTokensPerDay: number;
	peakDayAt: string | null;
}
interface Capacity {
	start: string;
	end: string;
	summary: Metrics;
	days: { timestamp: string; tokens: number; partial: boolean }[];
	breakdown: (Metrics & { key: string; label: string })[];
}

async function insertMinute(
	timestamp: string,
	input: number,
	output: number,
	model = MODELS[0],
	mode: "credits" | "api-keys" = "credits",
) {
	await db.insert(tables.modelProviderMappingHistory).values({
		modelId: model,
		providerId: "capacity-provider",
		modelProviderMappingId: model,
		minuteTimestamp: new Date(timestamp),
		usedMode: mode,
		logsCount: 1,
		totalInputTokens: input,
		totalOutputTokens: output,
		totalTokens: input + output,
		// Subtotals must not be counted again.
		totalReasoningTokens: output,
		totalCachedTokens: input,
	});
}
async function insertHour(
	timestamp: string,
	input: number,
	output: number,
	model = MODELS[0],
	mode: "credits" | "api-keys" = "credits",
) {
	await db.insert(tables.modelProviderMappingHistoryHourly).values({
		modelId: model,
		providerId: "capacity-provider",
		modelProviderMappingId: model,
		hourTimestamp: new Date(timestamp),
		usedMode: mode,
		logsCount: 1,
		totalInputTokens: input,
		totalOutputTokens: output,
		totalTokens: input + output,
	});
}

async function clearHistory() {
	await db
		.delete(tables.modelProviderMappingHistory)
		.where(inArray(tables.modelProviderMappingHistory.modelId, MODELS));
	await db
		.delete(tables.modelProviderMappingHistoryHourly)
		.where(inArray(tables.modelProviderMappingHistoryHourly.modelId, MODELS));
}

describe("admin token capacity", () => {
	let cookie: string;
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "admin@example.com");
		cookie = await createTestUser();
		await clearHistory();
	});
	afterEach(async () => {
		await clearHistory();
		await deleteAll();
		vi.unstubAllEnvs();
		vi.useRealTimers();
	});
	async function fetchCapacity(
		query: Record<string, string> = {},
	): Promise<Capacity> {
		const response = await app.request(
			`/admin/load/token-capacity?${new URLSearchParams(query)}`,
			{ headers: { Cookie: cookie } },
		);
		expect(response.status).toBe(200);
		return (await response.json()) as Capacity;
	}

	test("combines hourly totals and minute boundaries without overlap, includes quiet minutes", async () => {
		await insertMinute("2026-10-01T12:34:00Z", 9000, 0); // Before inward-rounded start
		await insertMinute("2026-10-01T12:35:00Z", 100, 0);
		await insertHour("2026-10-01T12:00:00Z", 9100, 0); // Excluded boundary hour
		await insertMinute("2026-10-02T05:00:00Z", 100, 200);
		await insertHour("2026-10-02T05:00:00Z", 100, 200);
		await insertMinute("2026-10-08T12:33:00Z", 20, 30);
		await insertHour("2026-10-08T12:00:00Z", 9000, 0); // Minute edge wins
		await insertMinute("2026-10-08T12:34:00Z", 9000, 0); // Incomplete minute
		await insertMinute("2026-10-08T13:00:00Z", 9000, 0); // Future
		const result = await fetchCapacity();
		expect(result.start).toBe("2026-10-01T12:35:00.000Z");
		expect(result.end).toBe("2026-10-08T12:34:00.000Z");
		expect(result.summary.totalTokens).toBe(450);
		expect(result.summary.avgTpm).toBeCloseTo(450 / 10079);
		expect(result.summary.avgTokensPerDay).toBeCloseTo((450 / 10079) * 1440);
		expect(result.summary.peakTpm).toBe(300);
		expect(result.summary.peakTokensPerDay).toBe(300);
		expect(result.days).toHaveLength(8);
		expect(result.days[0].partial).toBe(true);
		expect(result.days.at(-1)?.partial).toBe(true);
		expect(result.days[2].tokens).toBe(0);
	});

	test("sums simultaneous usage before taking platform/provider peaks", async () => {
		await insertMinute("2026-10-02T05:00:00Z", 100, 0);
		await insertMinute("2026-10-02T05:01:00Z", 0, 200, MODELS[1]);
		await insertMinute("2026-10-02T05:02:00Z", 90, 20);
		await insertMinute("2026-10-02T05:02:00Z", 100, 10, MODELS[1]);
		await insertHour("2026-10-02T05:00:00Z", 190, 20);
		await insertHour("2026-10-02T05:00:00Z", 100, 210, MODELS[1]);
		const models = await fetchCapacity();
		const providers = await fetchCapacity({ groupBy: "provider" });
		expect(models.summary).toEqual(providers.summary);
		expect(models.summary.peakTpm).toBe(220);
		expect(providers.breakdown[0].peakTpm).toBe(220);
		expect(models.breakdown.map((row) => row.peakTpm)).toEqual([200, 110]);
		const input = await fetchCapacity({ tokenType: "input" });
		const output = await fetchCapacity({ tokenType: "output" });
		expect(input.summary.peakTpm).toBe(190);
		expect(input.summary.peakMinuteAt).toBe("2026-10-02T05:02:00Z");
		expect(output.summary.peakTpm).toBe(200);
		expect(output.summary.peakMinuteAt).toBe("2026-10-02T05:01:00Z");
		expect(input.summary.totalTokens + output.summary.totalTokens).toBe(
			models.summary.totalTokens,
		);
	});

	test("excludes partial calendar days even when they are busiest", async () => {
		await insertHour("2026-10-01T14:00:00Z", 2000, 0);
		await insertHour("2026-10-02T14:00:00Z", 100, 0);
		await insertHour("2026-10-08T10:00:00Z", 3000, 0);
		const result = await fetchCapacity();
		expect(result.summary.peakTokensPerDay).toBe(100);
		expect(result.summary.peakDayAt).toBe("2026-10-02T00:00:00Z");
	});

	test("filters billing modes and retains canonical/mapping grouping", async () => {
		await insertMinute("2026-10-02T05:00:00Z", 20, 10);
		await insertMinute("2026-10-02T05:00:00Z", 30, 40, MODELS[0], "api-keys");
		await insertHour("2026-10-02T05:00:00Z", 20, 10);
		await insertHour("2026-10-02T05:00:00Z", 30, 40, MODELS[0], "api-keys");
		expect((await fetchCapacity()).summary.totalTokens).toBe(100);
		const credits = await fetchCapacity({
			mode: "credits",
			modelView: "mapping",
		});
		expect(credits.summary.totalTokens).toBe(30);
		expect(credits.summary.peakTpm).toBe(30);
		expect(credits.breakdown[0].key).toBe("capacity-provider/capacity-a");
		expect((await fetchCapacity({ mode: "api-keys" })).summary.peakTpm).toBe(
			70,
		);
	});

	test("excludes regional copies from both rollup sources and peaks", async () => {
		await db.insert(tables.provider).values({
			id: "capacity-provider",
			name: "Capacity provider",
			description: "Token capacity test provider",
		});
		await db
			.insert(tables.model)
			.values({ id: MODELS[0], name: "Capacity model", family: "capacity" });
		await db.insert(tables.modelProviderMapping).values({
			id: "capacity-region",
			providerId: "capacity-provider",
			modelId: MODELS[0],
			externalId: MODELS[0],
			region: "test-region",
		});
		try {
			await insertMinute("2026-10-02T05:00:00Z", 100, 0);
			await insertHour("2026-10-02T05:00:00Z", 100, 0);
			await db.insert(tables.modelProviderMappingHistory).values({
				modelId: MODELS[0],
				providerId: "capacity-provider",
				modelProviderMappingId: "capacity-region",
				minuteTimestamp: new Date("2026-10-02T05:00:00Z"),
				totalTokens: 100,
				usedMode: "credits",
			});
			await db.insert(tables.modelProviderMappingHistoryHourly).values({
				modelId: MODELS[0],
				providerId: "capacity-provider",
				modelProviderMappingId: "capacity-region",
				hourTimestamp: new Date("2026-10-02T05:00:00Z"),
				totalTokens: 100,
				usedMode: "credits",
			});
			const result = await fetchCapacity();
			expect(result.summary.totalTokens).toBe(100);
			expect(result.summary.peakTpm).toBe(100);
		} finally {
			await clearHistory();
			await db
				.delete(tables.modelProviderMapping)
				.where(inArray(tables.modelProviderMapping.id, ["capacity-region"]));
			await db.delete(tables.model).where(inArray(tables.model.id, MODELS));
			await db
				.delete(tables.provider)
				.where(inArray(tables.provider.id, ["capacity-provider"]));
		}
	});

	test("caps the breakdown at ten while keeping all traffic in platform totals", async () => {
		for (let i = 0; i < 12; i++) {
			const providerId = `capacity-provider-${i}`;
			const common = {
				modelId: MODELS[0],
				providerId,
				modelProviderMappingId: providerId,
				totalTokens: i + 1,
				usedMode: "credits" as const,
			};
			await db.insert(tables.modelProviderMappingHistory).values({
				...common,
				minuteTimestamp: new Date("2026-10-02T05:00:00Z"),
			});
			await db
				.insert(tables.modelProviderMappingHistoryHourly)
				.values({ ...common, hourTimestamp: new Date("2026-10-02T05:00:00Z") });
		}
		const result = await fetchCapacity({ groupBy: "provider" });
		expect(result.breakdown).toHaveLength(10);
		expect(result.breakdown[0].totalTokens).toBe(12);
		expect(result.breakdown.at(-1)?.totalTokens).toBe(3);
		expect(result.summary.totalTokens).toBe(78);
		expect(result.summary.peakTpm).toBe(78);
	});

	test("supports 30 days without reading expired or incomplete minutes", async () => {
		await insertMinute("2026-09-08T12:34:00Z", 1000, 0);
		await insertMinute("2026-09-08T12:35:00Z", 100, 0);
		const result = await fetchCapacity({ window: "30d" });
		expect(result.start).toBe("2026-09-08T12:35:00.000Z");
		expect(result.summary.totalTokens).toBe(100);
		expect(result.summary.peakTpm).toBe(100);
		expect(result.days).toHaveLength(31);
	});

	test("returns zero counts and no peak timestamp for an empty window", async () => {
		const result = await fetchCapacity();
		expect(result.summary).toEqual({
			totalTokens: 0,
			avgTpm: 0,
			peakTpm: 0,
			peakMinuteAt: null,
			avgTokensPerDay: 0,
			peakTokensPerDay: 0,
			peakDayAt: null,
		});
		expect(result.breakdown).toEqual([]);
	});

	test("rejects unsupported scopes and requires admin access", async () => {
		for (const query of [
			"window=90d",
			"groupBy=organization",
			"tokenType=reasoning",
		]) {
			expect(
				(
					await app.request(`/admin/load/token-capacity?${query}`, {
						headers: { Cookie: cookie },
					})
				).status,
			).toBe(400);
		}
		expect((await app.request("/admin/load/token-capacity")).status).toBe(401);
		vi.stubEnv("ADMIN_FULL_ACCESS_EMAILS", "");
		expect(
			(
				await app.request("/admin/load/token-capacity", {
					headers: { Cookie: cookie },
				})
			).status,
		).toBe(403);
	});
});
