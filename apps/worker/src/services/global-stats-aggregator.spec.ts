import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
	and,
	db,
	eq,
	globalModelStats,
	globalSourceStats,
	log,
	organization,
	project,
	user,
} from "@llmgateway/db";

import { aggregateWindowIntoStats } from "./global-stats-aggregator.js";

const HOUR_MS = 60 * 60 * 1000;

// A fixed historical window well outside anything the walker processes, so
// these rows can never collide with real aggregates in the shared test DB.
const WINDOW_START = new Date("2001-03-04T05:00:00Z");

describe("global stats aggregation", () => {
	// Fresh ids per test: the shared test database is not reset between runs, and
	// the dimension columns are part of the unique key, so leftovers from a
	// failed cleanup would silently change the assertions below.
	let suffix = "";
	let ids = {
		userId: "",
		paygOrgId: "",
		devpassOrgId: "",
		paygProjectId: "",
		devpassProjectId: "",
		model: "",
		source: "",
	};

	const insertLog = (values: {
		organizationId: string;
		projectId: string;
		usedMode: "credits" | "api-keys";
		cost: number;
		totalTokens?: string;
		createdAt?: Date;
		providerMarginPercent?: number;
		cached?: boolean;
	}) =>
		db.insert(log).values({
			requestId: `global-stats-request-${randomUUID()}`,
			createdAt: values.createdAt ?? new Date(WINDOW_START.getTime() + 60_000),
			organizationId: values.organizationId,
			projectId: values.projectId,
			apiKeyId: `global-stats-api-key-${suffix}`,
			source: ids.source,
			cost: values.cost,
			providerMarginPercent: values.providerMarginPercent,
			cached: values.cached ?? false,
			promptTokens: "10",
			completionTokens: "20",
			totalTokens: values.totalTokens ?? "30",
			duration: 1000,
			mode: values.usedMode,
			usedMode: values.usedMode,
			requestedModel: ids.model,
			requestedProvider: "openai",
			usedModel: ids.model,
			usedProvider: "openai",
			responseSize: 100,
			unifiedFinishReason: "completed",
		});

	const aggregate = () =>
		db.transaction((tx) => aggregateWindowIntoStats(tx, WINDOW_START, HOUR_MS));

	const readModelStats = () =>
		db
			.select()
			.from(globalModelStats)
			.where(eq(globalModelStats.usedModel, ids.model));

	const readSourceStats = () =>
		db
			.select()
			.from(globalSourceStats)
			.where(eq(globalSourceStats.source, ids.source));

	beforeEach(async () => {
		suffix = randomUUID();
		ids = {
			userId: `global-stats-user-${suffix}`,
			paygOrgId: `global-stats-payg-org-${suffix}`,
			devpassOrgId: `global-stats-devpass-org-${suffix}`,
			paygProjectId: `global-stats-payg-project-${suffix}`,
			devpassProjectId: `global-stats-devpass-project-${suffix}`,
			model: `global-stats-model-${suffix}`,
			source: `global-stats-source-${suffix}`,
		};

		await db.insert(user).values({
			id: ids.userId,
			email: `global-stats-${suffix}@example.com`,
			name: "Global Stats",
		});
		await db.insert(organization).values([
			{
				id: ids.paygOrgId,
				name: "Global Stats PAYG Org",
				billingEmail: `global-stats-payg-${suffix}@example.com`,
				kind: "default",
				credits: "100",
			},
			{
				id: ids.devpassOrgId,
				name: "Global Stats DevPass Org",
				billingEmail: `global-stats-devpass-${suffix}@example.com`,
				kind: "devpass",
				credits: "100",
			},
		]);
		await db.insert(project).values([
			{
				id: ids.paygProjectId,
				name: "Global Stats PAYG Project",
				organizationId: ids.paygOrgId,
				mode: "credits",
			},
			{
				id: ids.devpassProjectId,
				name: "Global Stats DevPass Project",
				organizationId: ids.devpassOrgId,
				mode: "credits",
			},
		]);
	});

	afterEach(async () => {
		await db
			.delete(globalModelStats)
			.where(eq(globalModelStats.usedModel, ids.model));
		await db
			.delete(globalSourceStats)
			.where(eq(globalSourceStats.source, ids.source));
		await db.delete(log).where(eq(log.organizationId, ids.paygOrgId));
		await db.delete(log).where(eq(log.organizationId, ids.devpassOrgId));
		await db.delete(log).where(eq(log.organizationId, `missing-${suffix}`));
		await db.delete(project).where(eq(project.id, ids.paygProjectId));
		await db.delete(project).where(eq(project.id, ids.devpassProjectId));
		await db.delete(organization).where(eq(organization.id, ids.paygOrgId));
		await db.delete(organization).where(eq(organization.id, ids.devpassOrgId));
		await db.delete(user).where(eq(user.id, ids.userId));
	});

	test("keys one row per billing mode and organization kind", async () => {
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.01,
		});
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "api-keys",
			cost: 0,
		});
		await insertLog({
			organizationId: ids.devpassOrgId,
			projectId: ids.devpassProjectId,
			usedMode: "credits",
			cost: 0.02,
		});
		await insertLog({
			organizationId: ids.devpassOrgId,
			projectId: ids.devpassProjectId,
			usedMode: "credits",
			cost: 0.03,
		});

		await aggregate();

		const rows = await readModelStats();
		expect(rows.map((row) => `${row.orgKind}/${row.usedMode}`).sort()).toEqual([
			"default/api-keys",
			"default/credits",
			"devpass/credits",
		]);

		const paygCredits = rows.find(
			(row) => row.orgKind === "default" && row.usedMode === "credits",
		);
		expect(paygCredits!.requestCount).toBe(1);
		expect(Number(paygCredits!.cost)).toBeCloseTo(0.01, 6);

		const paygByok = rows.find(
			(row) => row.orgKind === "default" && row.usedMode === "api-keys",
		);
		expect(paygByok!.requestCount).toBe(1);
		expect(Number(paygByok!.cost)).toBe(0);

		// Every measure — not just cost and request counts — is scoped to the
		// dimension tuple, which is the whole point of keying on it.
		const devpassCredits = rows.find(
			(row) => row.orgKind === "devpass" && row.usedMode === "credits",
		);
		expect(devpassCredits!.requestCount).toBe(2);
		expect(Number(devpassCredits!.cost)).toBeCloseTo(0.05, 6);
		expect(String(devpassCredits!.totalTokens)).toBe("60");
		expect(String(devpassCredits!.inputTokens)).toBe("20");
	});

	test("blended totals are unchanged by the split", async () => {
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.01,
		});
		await insertLog({
			organizationId: ids.devpassOrgId,
			projectId: ids.devpassProjectId,
			usedMode: "api-keys",
			cost: 0.02,
		});

		await aggregate();

		const rows = await readModelStats();
		const totalRequests = rows.reduce((sum, row) => sum + row.requestCount, 0);
		const totalCost = rows.reduce((sum, row) => sum + Number(row.cost), 0);
		expect(totalRequests).toBe(2);
		expect(totalCost).toBeCloseTo(0.03, 6);
	});

	test("keeps requests whose organization row is gone", async () => {
		// log.organizationId has no foreign key, so an inner join here would drop
		// these requests from global stats entirely instead of bucketing them.
		await insertLog({
			organizationId: `missing-${suffix}`,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.07,
		});

		await aggregate();

		const rows = await readModelStats();
		expect(rows).toHaveLength(1);
		expect(rows[0].orgKind).toBe("unknown");
		expect(rows[0].requestCount).toBe(1);
		expect(Number(rows[0].cost)).toBeCloseTo(0.07, 6);
	});

	test("accumulates across buckets within the same day", async () => {
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.01,
		});
		await aggregate();

		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.02,
			createdAt: new Date(WINDOW_START.getTime() + HOUR_MS + 60_000),
		});
		await db.transaction((tx) =>
			aggregateWindowIntoStats(
				tx,
				new Date(WINDOW_START.getTime() + HOUR_MS),
				HOUR_MS,
			),
		);

		const rows = await readModelStats();
		expect(rows).toHaveLength(1);
		expect(rows[0].requestCount).toBe(2);
		expect(Number(rows[0].cost)).toBeCloseTo(0.03, 6);
	});

	test("rolls the snapshotted provider margin into providerMarginAmount", async () => {
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.1,
			providerMarginPercent: 0.3,
		});
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.2,
			providerMarginPercent: 0.25,
		});
		// No snapshot (provider without routing settings) → contributes nothing.
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.5,
		});
		// Cache hits do not incur a second provider charge, even if a malformed
		// historical row carries a non-zero cost and margin snapshot.
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.6,
			providerMarginPercent: 0.5,
			cached: true,
		});
		// BYOK pays the provider directly, so it cannot earn gateway margin.
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "api-keys",
			cost: 0.4,
			providerMarginPercent: 0.5,
		});

		await aggregate();

		const rows = await readModelStats();
		expect(rows).toHaveLength(2);
		const credits = rows.find((row) => row.usedMode === "credits");
		const byok = rows.find((row) => row.usedMode === "api-keys");
		expect(Number(credits?.cost)).toBeCloseTo(1.4, 6);
		expect(Number(credits?.providerMarginAmount)).toBeCloseTo(
			0.1 * 0.3 + 0.2 * 0.25, // eslint-disable-line no-mixed-operators
			6,
		);
		expect(Number(byok?.cost)).toBeCloseTo(0.4, 6);
		expect(Number(byok?.providerMarginAmount)).toBe(0);
	});

	test("applies the same dimensions to source stats", async () => {
		await insertLog({
			organizationId: ids.paygOrgId,
			projectId: ids.paygProjectId,
			usedMode: "credits",
			cost: 0.01,
		});
		await insertLog({
			organizationId: ids.devpassOrgId,
			projectId: ids.devpassProjectId,
			usedMode: "api-keys",
			cost: 0.02,
		});

		await aggregate();

		const rows = await readSourceStats();
		expect(rows).toHaveLength(2);
		expect(
			await db
				.select()
				.from(globalSourceStats)
				.where(
					and(
						eq(globalSourceStats.source, ids.source),
						eq(globalSourceStats.orgKind, "devpass"),
						eq(globalSourceStats.usedMode, "api-keys"),
					),
				),
		).toHaveLength(1);
	});
});
