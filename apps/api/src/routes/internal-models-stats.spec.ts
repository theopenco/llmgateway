import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

vi.mock("@/lib/arena-benchmarks.js", () => ({
	getArenaBenchmarks: vi.fn(async () => ({ text: [], code: [] })),
	findArenaMatch: vi.fn(() => null),
}));

const PROVIDER_ID = "model-stats-test-carrier";
const MODEL_ID = "model-stats-test-model";

async function seedMinute(
	usedMode: "credits" | "api-keys",
	stats: { logsCount: number; gatewayErrorsCount: number },
) {
	const minuteMs = 60_000;
	const previousMinute = Math.floor(Date.now() / minuteMs) - 1;
	await db.insert(tables.modelProviderMappingHistory).values({
		modelId: MODEL_ID,
		providerId: PROVIDER_ID,
		modelProviderMappingId: `${MODEL_ID}::${PROVIDER_ID}`,
		minuteTimestamp: new Date(previousMinute * minuteMs),
		usedMode,
		errorsCount: stats.gatewayErrorsCount,
		...stats,
	});
}

describe("public model stats", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.delete(tables.modelProviderMappingHistory);
		await db.insert(tables.provider).values({
			id: PROVIDER_ID,
			name: "Test carrier",
			description: "Database-only carrier",
		});
		await seedMinute("credits", { logsCount: 10, gatewayErrorsCount: 1 });
		// A customer's broken key must not count against the provider.
		await seedMinute("api-keys", { logsCount: 50, gatewayErrorsCount: 50 });
	});

	afterEach(async () => {
		await db.delete(tables.modelProviderMappingHistory);
		await db.delete(tables.provider).where(eq(tables.provider.id, PROVIDER_ID));
		await deleteAll();
	});

	test("uptime excludes bring-your-own-key traffic", async () => {
		const res = await app.request(`/internal/models/${MODEL_ID}/uptime`);
		expect(res.status).toBe(200);
		const body = await res.json();
		const provider = body.providers.find(
			(p: { providerId: string }) => p.providerId === PROVIDER_ID,
		);
		expect(provider.logsCount).toBe(10);
		expect(provider.errorsCount).toBe(1);
		expect(provider.uptime).toBe(90);
	});

	test("benchmarks exclude bring-your-own-key traffic", async () => {
		const res = await app.request(`/internal/models/${MODEL_ID}/benchmarks`);
		expect(res.status).toBe(200);
		const body = await res.json();
		const provider = body.providers.find(
			(p: { providerId: string }) => p.providerId === PROVIDER_ID,
		);
		expect(provider.logsCount).toBe(10);
		expect(provider.errorsCount).toBe(1);
		expect(provider.uptime).toBe(90);
	});
});
