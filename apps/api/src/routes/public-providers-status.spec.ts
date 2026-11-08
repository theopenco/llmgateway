import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { resetLocalPublicResponseCache } from "@/lib/public-response-cache.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { isStealthProvider, providers } from "@llmgateway/models";

import { STATUS_HISTORY_DAYS } from "./public-providers-status.js";

const PROVIDER_ID = "anthropic";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let seq = 0;

async function seedHour(
	hoursAgo: number,
	stats: {
		logsCount: number;
		clientErrorsCount?: number;
		gatewayErrorsCount?: number;
		upstreamErrorsCount?: number;
	},
	options: { usedMode?: "credits" | "api-keys"; providerId?: string } = {},
) {
	const ageMs = hoursAgo * HOUR_MS;
	const hourTimestamp = new Date(
		Math.floor((Date.now() - ageMs) / HOUR_MS) * HOUR_MS,
	);
	seq += 1;
	await db.insert(tables.modelProviderMappingHistoryHourly).values({
		modelId: "claude-test",
		providerId: options.providerId ?? PROVIDER_ID,
		modelProviderMappingId: `status-test-${seq}`,
		usedMode: options.usedMode ?? "credits",
		hourTimestamp,
		...stats,
	});
}

function summaryResponse(indicator: string) {
	return new Response(
		JSON.stringify({
			status: { indicator, description: `Status ${indicator}` },
			components: [{ name: "Claude API", status: "operational" }],
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

const incidentsResponse = () =>
	new Response(
		JSON.stringify({
			incidents: [
				{
					id: "inc-1",
					name: "Elevated errors on Claude API",
					status: "resolved",
					impact: "minor",
					created_at: new Date(Date.now() - DAY_MS).toISOString(),
					resolved_at: new Date(Date.now() - DAY_MS + HOUR_MS).toISOString(),
					shortlink: "https://stspg.io/inc-1",
				},
			],
		}),
		{ headers: { "content-type": "application/json" } },
	);

async function statusPageHandler(input: string | URL | Request) {
	const url = String(input instanceof Request ? input.url : input);
	if (url.startsWith("https://status.claude.com/api/v2/summary.json")) {
		return summaryResponse("minor");
	}
	if (url.startsWith("https://status.claude.com/api/v2/incidents.json")) {
		return incidentsResponse();
	}
	return new Response("not found", { status: 404 });
}

const fetchMock = vi.fn(statusPageHandler);

describe("public providers status", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await redisClient.flushdb();
		resetLocalPublicResponseCache();
		fetchMock.mockReset();
		fetchMock.mockImplementation(statusPageHandler);
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await deleteAll();
	});

	test("returns official status and measured history", async () => {
		await seedHour(1, {
			logsCount: 100,
			clientErrorsCount: 10,
			upstreamErrorsCount: 9,
		});
		await seedHour(30, { logsCount: 50, gatewayErrorsCount: 5 });
		await seedHour(
			1,
			{ logsCount: 1000, upstreamErrorsCount: 1000 },
			{
				usedMode: "api-keys",
			},
		);
		await seedHour(
			1,
			{ logsCount: 70, upstreamErrorsCount: 70 },
			{
				providerId: "openai",
			},
		);
		await seedHour((STATUS_HISTORY_DAYS + 2) * 24, {
			logsCount: 40,
			upstreamErrorsCount: 40,
		});

		const res = await app.request(`/public/providers/status/${PROVIDER_ID}`);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.providerId).toBe(PROVIDER_ID);
		expect(body.statusPageUrl).toBe("https://status.claude.com");
		expect(body.official).toMatchObject({
			indicator: "minor",
			components: [{ name: "Claude API", status: "operational" }],
			incidents: [
				{ id: "inc-1", impact: "minor", url: "https://stspg.io/inc-1" },
			],
		});

		expect(body.measured.days).toHaveLength(STATUS_HISTORY_DAYS);
		const today = new Date().toISOString().slice(0, 10);
		expect(body.measured.days.at(-1).date).toBe(today);
		expect(body.measured.last24h).toEqual({
			requestCount: 90,
			errorsCount: 9,
			uptime: 90,
		});
		expect(body.measured.last90d.requestCount).toBe(140);
		expect(body.measured.last90d.errorsCount).toBe(14);
		expect(
			body.measured.days.reduce(
				(sum: number, day: { requestCount: number }) => sum + day.requestCount,
				0,
			),
		).toBe(140);
		const idleDays = body.measured.days.filter(
			(day: { uptime: number | null }) => day.uptime === null,
		);
		expect(idleDays.length).toBeGreaterThanOrEqual(STATUS_HISTORY_DAYS - 3);
	});

	test("lists official status for public providers", async () => {
		await seedHour(2, { logsCount: 200, upstreamErrorsCount: 2 });
		await seedHour(30, { logsCount: 500, upstreamErrorsCount: 500 });
		const res = await app.request("/public/providers/status");
		expect(res.status).toBe(200);
		const body = await res.json();
		const ids = body.providers.map((p: { providerId: string }) => p.providerId);

		expect(ids).toContain(PROVIDER_ID);
		expect(ids).not.toContain("llmgateway");
		expect(ids).not.toContain("custom");
		for (const stealth of providers.filter((p) => isStealthProvider(p))) {
			expect(ids).not.toContain(stealth.id);
		}
		expect(
			body.providers.find(
				(p: { providerId: string }) => p.providerId === PROVIDER_ID,
			).official,
		).toEqual({ indicator: "minor", description: "Status minor" });
		expect(
			body.providers.find(
				(p: { providerId: string }) => p.providerId === PROVIDER_ID,
			).last24h,
		).toEqual({ requestCount: 200, errorsCount: 2, uptime: 99 });
		expect(
			body.providers.find(
				(p: { providerId: string }) => p.providerId === "openai",
			).last24h,
		).toEqual({ requestCount: 0, errorsCount: 0, uptime: null });
		expect(
			body.providers.find(
				(p: { providerId: string }) => p.providerId === "openai",
			).official,
		).toBeNull();
	});

	test("caches official status between requests", async () => {
		await app.request(`/public/providers/status/${PROVIDER_ID}`);
		await app.request(`/public/providers/status/${PROVIDER_ID}`);

		expect(
			fetchMock.mock.calls.filter(([input]) =>
				String(input).endsWith("/summary.json"),
			),
		).toHaveLength(1);
	});

	test("still serves measured uptime when the status page is down", async () => {
		fetchMock.mockImplementation(async () => {
			throw new TypeError("fetch failed");
		});
		await seedHour(1, { logsCount: 10 });

		const res = await app.request(`/public/providers/status/${PROVIDER_ID}`);
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.official).toBeNull();
		expect(body.measured.last24h.requestCount).toBe(10);
	});

	test.each([
		"unknown-provider",
		"llmgateway",
		"custom",
		...providers.filter((p) => isStealthProvider(p)).map((p) => p.id),
	])("returns 404 for %s", async (providerId) => {
		const res = await app.request(`/public/providers/status/${providerId}`);
		expect(res.status).toBe(404);
	});
});
