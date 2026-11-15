import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, eq, inArray, systemSetting, tables } from "@llmgateway/db";
import { MODEL_ERROR_RATE_ALERTS_SETTING_ID } from "@llmgateway/shared";

import {
	checkFailingCredentialAlerts,
	credentialCooldownKey,
	findFailingCredentials,
} from "./failing-credential-alerts.js";

const HOUR_MS = 60 * 60 * 1000;
const orgId = "fca-org";
const projectId = "fca-project";
const keyIds = [
	"fca-dead",
	"fca-client",
	"fca-flaky",
	"fca-quiet",
	"fca-off",
	"fca-stale",
];

async function seedKey(key: {
	id: string;
	status?: "active" | "inactive";
	hoursAgo?: number;
	requestCount: number;
	clientErrorCount?: number;
	gatewayErrorCount?: number;
	upstreamErrorCount?: number;
}) {
	await db.insert(tables.providerKey).values({
		id: key.id,
		...encryptProviderKeyForStorage(`fca-token-${key.id}`, key.id, null),
		provider: "openai",
		comment: `note ${key.id}`,
		managed: true,
		organizationId: null,
		status: key.status ?? "active",
	});
	const currentHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
	const offsetMs = (key.hoursAgo ?? 0) * HOUR_MS;
	const clientErrorCount = key.clientErrorCount ?? 0;
	const gatewayErrorCount = key.gatewayErrorCount ?? 0;
	const upstreamErrorCount = key.upstreamErrorCount ?? 0;
	await db.insert(tables.providerKeyHourlyStats).values({
		providerKeyId: key.id,
		projectId,
		hourTimestamp: new Date(currentHour - offsetMs),
		cost: 0,
		requestCount: key.requestCount,
		errorCount: clientErrorCount + gatewayErrorCount + upstreamErrorCount,
		clientErrorCount,
		gatewayErrorCount,
		upstreamErrorCount,
	});
}

async function saveSetting(enabled: boolean) {
	await db
		.insert(systemSetting)
		.values({ id: MODEL_ERROR_RATE_ALERTS_SETTING_ID, enabled, value: "{}" })
		.onConflictDoUpdate({ target: systemSetting.id, set: { enabled } });
}

async function cleanup() {
	await redisClient.del(...keyIds.map(credentialCooldownKey));
	await db
		.delete(tables.providerKeyHourlyStats)
		.where(inArray(tables.providerKeyHourlyStats.providerKeyId, keyIds));
	await db
		.delete(tables.providerKey)
		.where(inArray(tables.providerKey.id, keyIds));
	await db.delete(tables.project).where(eq(tables.project.id, projectId));
	await db.delete(tables.organization).where(eq(tables.organization.id, orgId));
	await db.delete(systemSetting);
}

describe("failing credential alerts", () => {
	const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
	const originalUrl = process.env.MODEL_ERROR_RATE_DISCORD_URL;

	beforeEach(async () => {
		await cleanup();
		vi.stubGlobal("fetch", fetchMock);
		process.env.MODEL_ERROR_RATE_DISCORD_URL = "https://discord.test/webhook";
		await db.insert(tables.organization).values({
			id: orgId,
			name: "FCA Org",
			billingEmail: "fca@example.com",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "FCA Project",
			organizationId: orgId,
		});
		await seedKey({ id: "fca-dead", requestCount: 12, upstreamErrorCount: 12 });
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		fetchMock.mockClear();
		if (originalUrl === undefined) {
			delete process.env.MODEL_ERROR_RATE_DISCORD_URL;
		} else {
			process.env.MODEL_ERROR_RATE_DISCORD_URL = originalUrl;
		}
		await cleanup();
	});

	it("finds active managed credentials failing 90%+ of 10+ requests in 4h", async () => {
		// 9 of 10 once client errors are excluded.
		await seedKey({
			id: "fca-client",
			hoursAgo: 3,
			requestCount: 30,
			clientErrorCount: 20,
			gatewayErrorCount: 9,
		});
		await seedKey({
			id: "fca-flaky",
			requestCount: 100,
			upstreamErrorCount: 89,
		});
		await seedKey({ id: "fca-quiet", requestCount: 9, upstreamErrorCount: 9 });
		await seedKey({
			id: "fca-off",
			status: "inactive",
			requestCount: 50,
			upstreamErrorCount: 50,
		});
		await seedKey({
			id: "fca-stale",
			hoursAgo: 4,
			requestCount: 50,
			upstreamErrorCount: 50,
		});

		const failing = await findFailingCredentials();
		expect(failing.map(({ id, errorRate }) => ({ id, errorRate }))).toEqual([
			{ id: "fca-dead", errorRate: 100 },
			{ id: "fca-client", errorRate: 90 },
		]);
	});

	it("does nothing while error-rate alerts are off or without a webhook", async () => {
		await checkFailingCredentialAlerts();
		await saveSetting(false);
		await checkFailingCredentialAlerts();
		await saveSetting(true);
		delete process.env.MODEL_ERROR_RATE_DISCORD_URL;
		await checkFailingCredentialAlerts();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("alerts once per credential per cooldown", async () => {
		await saveSetting(true);
		await checkFailingCredentialAlerts();
		await checkFailingCredentialAlerts();

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://discord.test/webhook");
		const body = JSON.parse(String(init.body));
		expect(body.embeds[0].title).toBe("Failing provider credentials");
		expect(body.embeds[0].fields[0].name).toBe("openai · note fca-dead");
		expect(body.embeds[0].fields[0].value).toContain("**100.0%** · 12/12");
		expect(String(init.body).includes("fca-token-")).toBe(false);
	});

	it("releases the cooldown when delivery fails", async () => {
		await saveSetting(true);
		fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
		await expect(checkFailingCredentialAlerts()).rejects.toThrow();
		expect(await redisClient.exists(credentialCooldownKey("fca-dead"))).toBe(0);

		await checkFailingCredentialAlerts();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
