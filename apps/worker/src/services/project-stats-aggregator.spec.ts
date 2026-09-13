import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, inArray, tables } from "@llmgateway/db";

import {
	refreshProjectHourlyStats,
	refreshCurrentHourStats,
} from "./project-stats-aggregator.js";

const statsTables = [
	tables.projectHourlyStats,
	tables.projectHourlyModelStats,
	tables.projectHourlySourceStats,
	tables.apiKeyHourlyStats,
	tables.apiKeyHourlyModelStats,
	tables.apiKeyHourlySourceStats,
	tables.providerKeyHourlyStats,
];

const hour = new Date("2026-09-12T10:00:00Z");
const projectIds = ["batch-stats-project-a", "batch-stats-project-b"];
const extraProjectIds = Array.from(
	{ length: 99 },
	(_, i) => `batch-stats-project-extra-${i}`,
);
const orgId = "batch-stats-org";
const userId = "batch-stats-user";

function logValues(
	overrides: Partial<typeof tables.log.$inferInsert> = {},
): typeof tables.log.$inferInsert {
	return {
		requestId: randomUUID(),
		organizationId: orgId,
		projectId: projectIds[0],
		apiKeyId: "batch-key-user",
		providerKeyId: "batch-provider-key",
		createdAt: new Date("2026-09-12T10:01:00Z"),
		requestedModel: "test-model",
		usedModel: "test-model",
		usedProvider: "test-provider",
		duration: 100,
		responseSize: 100,
		mode: "credits",
		usedMode: "credits",
		source: "test-source",
		unifiedFinishReason: "completed",
		promptTokens: "10",
		completionTokens: "20",
		totalTokens: "30",
		cost: 0.25,
		dataStorageCost: "0.125",
		providerMarginPercent: 0.2,
		...overrides,
	};
}

async function readAllStats() {
	const snapshots = [];
	for (const table of statsTables) {
		const rows = await db
			.select()
			.from(table)
			.where(inArray(table.projectId, projectIds));
		snapshots.push(rows);
	}
	return snapshots;
}

describe("batched project stats refresh", () => {
	async function cleanup() {
		await db.delete(tables.log).where(eq(tables.log.organizationId, orgId));
		for (const table of statsTables) {
			await db
				.delete(table)
				.where(inArray(table.projectId, [...projectIds, ...extraProjectIds]));
		}
		await db
			.delete(tables.project)
			.where(eq(tables.project.organizationId, orgId));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, orgId));
		await db.delete(tables.user).where(eq(tables.user.id, userId));
	}

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-12T10:30:00Z"));
		await cleanup();
		await db
			.insert(tables.user)
			.values({ id: userId, email: "batch-stats@example.com" });
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "batch-stats@example.com",
		});
		await db.insert(tables.project).values(
			projectIds.map((id) => ({
				id,
				name: "Test Project",
				organizationId: orgId,
			})),
		);
		await db.insert(tables.apiKey).values(
			(
				[
					["user", projectIds[0]],
					["end_user_customer", projectIds[1]],
					["platform_secret", projectIds[0]],
				] as const
			).map(([keyType, projectId]) => ({
				id: `batch-key-${keyType}`,
				projectId,
				createdBy: userId,
				description: "Test key",
				tokenHash: `batch-hash-${keyType}`,
				tokenMasked: "synthetic",
				keyType,
			})),
		);
	});

	afterEach(async () => {
		vi.useRealTimers();
		await cleanup();
	});

	test("keeps projects, keys, sources and hour boundaries separate", async () => {
		await db.insert(tables.log).values([
			logValues(),
			logValues({ usedMode: "api-keys", source: null }),
			logValues({
				projectId: projectIds[1],
				apiKeyId: "batch-key-end_user_customer",
				cost: 0.5,
			}),
			logValues({
				apiKeyId: "batch-key-platform_secret",
				providerKeyId: null,
			}),
			logValues({ createdAt: new Date("2026-09-12T09:59:59Z"), cost: 100 }),
			logValues({ createdAt: new Date("2026-09-12T11:00:00Z"), cost: 100 }),
		]);
		await refreshCurrentHourStats();

		const projects = await db.query.projectHourlyStats.findMany({
			where: { projectId: { in: projectIds } },
		});
		expect(projects).toHaveLength(2);
		expect(
			projects.find((row) => row.projectId === projectIds[0]),
		).toMatchObject({
			requestCount: 3,
			cost: 0.75,
			creditsRequestCount: 2,
			apiKeysRequestCount: 1,
			totalTokens: "90",
		});
		expect(
			projects.find((row) => row.projectId === projectIds[1]),
		).toMatchObject({ requestCount: 1, cost: 0.5 });
		const keys = await db.query.apiKeyHourlyStats.findMany({
			where: { projectId: { in: projectIds } },
		});
		expect(keys).toHaveLength(2);
		expect(keys.find((row) => row.apiKeyId === "batch-key-user")).toMatchObject(
			{ requestCount: 2, cost: 0.5, creditsCost: 0.25, apiKeysCost: 0.25 },
		);
		for (const table of [
			tables.projectHourlySourceStats,
			tables.apiKeyHourlySourceStats,
		]) {
			const rows = await db
				.select()
				.from(table)
				.where(eq(table.projectId, projectIds[0]));
			expect(rows.find((row) => row.source === "unknown")).toMatchObject({
				requestCount: 1,
				cost: 0.25,
			});
		}
		const credentials = await db.query.providerKeyHourlyStats.findMany({
			where: { projectId: { in: projectIds } },
		});
		expect(credentials).toHaveLength(2);
		expect(
			credentials.find((row) => row.projectId === projectIds[0]),
		).toMatchObject({ requestCount: 2, cost: 0.5 });
		const models = await db.query.projectHourlyModelStats.findMany({
			where: { projectId: projectIds[0] },
		});
		expect(models[0].providerMarginAmount).toBeCloseTo(0.1);
	});

	test("skips unchanged detail writes and propagates corrected and late logs", async () => {
		await db
			.insert(tables.log)
			.values(logValues({ cost: 0.1, dataStorageCost: "0.12345678" }));
		await refreshCurrentHourStats();
		const past = new Date("2026-09-12T10:02:00Z");
		for (const table of statsTables) {
			await db
				.update(table)
				.set({ updatedAt: past })
				.where(eq(table.projectId, projectIds[0]));
		}
		await refreshCurrentHourStats();
		const unchanged = await readAllStats();
		expect(unchanged[0][0].updatedAt.getTime()).toBeGreaterThan(past.getTime());
		for (const rows of unchanged.slice(1)) {
			expect(rows[0].updatedAt).toEqual(past);
		}

		// Existing requests can be corrected without changing their creation time.
		await db
			.update(tables.log)
			.set({ cost: 0.5, promptTokens: "40", totalTokens: "60" })
			.where(eq(tables.log.projectId, projectIds[0]));
		await refreshCurrentHourStats();
		for (const rows of await readAllStats()) {
			expect(rows[0]).toMatchObject({
				requestCount: 1,
				cost: 0.5,
				inputTokens: "40",
				totalTokens: "60",
			});
		}
		await db.insert(tables.log).values(logValues());
		await refreshCurrentHourStats();
		const populated = await readAllStats();
		for (const rows of populated) {
			expect(rows[0]).toMatchObject({
				requestCount: 2,
				cost: 0.75,
				totalTokens: "90",
			});
		}

		await db.delete(tables.log).where(eq(tables.log.organizationId, orgId));
		await refreshCurrentHourStats();
		expect(await readAllStats()).toEqual(populated);
	});

	test("refreshes projects beyond the first read batch", async () => {
		await db.insert(tables.project).values(
			extraProjectIds.map((id) => ({
				id,
				name: "Test Project",
				organizationId: orgId,
			})),
		);
		await db.insert(tables.apiKey).values(
			extraProjectIds.map((projectId) => ({
				id: `${projectId}-key`,
				projectId,
				createdBy: userId,
				description: "Test key",
				tokenHash: `${projectId}-hash`,
				tokenMasked: "synthetic",
			})),
		);
		await db.insert(tables.log).values([
			logValues(),
			logValues({
				projectId: projectIds[1],
				apiKeyId: "batch-key-end_user_customer",
			}),
			...extraProjectIds.map((projectId) =>
				logValues({ projectId, apiKeyId: `${projectId}-key` }),
			),
		]);
		await refreshCurrentHourStats();
		for (const table of statsTables) {
			const rows = await db
				.select()
				.from(table)
				.where(inArray(table.projectId, [...projectIds, ...extraProjectIds]));
			expect(rows).toHaveLength(101);
			for (const row of rows) {
				expect(row).toMatchObject({ requestCount: 1, cost: 0.25 });
			}
		}
	});

	test("writes more than one batch and updates an existing final batch", async () => {
		await db.insert(tables.log).values(
			Array.from({ length: 501 }, (_, i) =>
				logValues({
					usedModel: `model-${i}`,
					source: `source-${i}`,
					providerKeyId: `credential-${i}`,
				}),
			),
		);
		await refreshCurrentHourStats();
		await db
			.update(tables.log)
			.set({ cost: 0.5 })
			.where(eq(tables.log.projectId, projectIds[0]));
		await refreshCurrentHourStats();
		for (const table of [
			tables.projectHourlyModelStats,
			tables.projectHourlySourceStats,
			tables.apiKeyHourlyModelStats,
			tables.apiKeyHourlySourceStats,
			tables.providerKeyHourlyStats,
		]) {
			const rows = await db
				.select()
				.from(table)
				.where(eq(table.projectId, projectIds[0]));
			expect(rows).toHaveLength(501);
			for (const row of rows) {
				expect(row).toMatchObject({ requestCount: 1, cost: 0.5 });
			}
		}
	});

	test("recalculates a stale project-hour without touching its neighbors", async () => {
		await db.insert(tables.log).values([
			logValues(),
			logValues({
				projectId: projectIds[1],
				apiKeyId: "batch-key-end_user_customer",
			}),
		]);
		await refreshCurrentHourStats();
		const neighbor = (await readAllStats()).map((rows) =>
			rows.filter((row) => row.projectId === projectIds[1]),
		);
		await db
			.update(tables.projectHourlyStats)
			.set({ updatedAt: new Date("2026-09-12T10:00:30Z") })
			.where(eq(tables.projectHourlyStats.projectId, projectIds[0]));
		await db
			.insert(tables.log)
			.values(logValues({ createdAt: new Date("2026-09-12T10:02:00Z") }));
		vi.setSystemTime(new Date("2026-09-12T11:30:00Z"));
		await refreshProjectHourlyStats();
		const refreshed = await readAllStats();
		for (const rows of refreshed) {
			expect(rows.find((row) => row.projectId === projectIds[0])).toMatchObject(
				{ requestCount: 2, hourTimestamp: hour },
			);
		}
		expect(
			refreshed.map((rows) =>
				rows.filter((row) => row.projectId === projectIds[1]),
			),
		).toEqual(neighbor);
	});
});
