import { execFileSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, inArray, tables, eq } from "@llmgateway/db";

const ORGS = ["refund-backfill-org", "refund-backfill-other"];
interface Report {
	changes: Array<{ id: string; after: string }>;
	skipped: Array<{ id: string; reason: string }>;
	upToDate: number;
}

function runBackfill(...args: string[]): Report {
	const url = new URL(process.env.DATABASE_URL!);
	if (
		!["localhost", "127.0.0.1", "postgres"].includes(url.hostname) ||
		!url.pathname.includes("test")
	) {
		throw new Error("Backfill test requires the isolated test database");
	}
	return JSON.parse(
		execFileSync(
			process.execPath,
			[
				"--import",
				"tsx",
				"packages/scripts/src/backfill-refund-descriptions.ts",
				"--json",
				`--org=${ORGS[0]}`,
				...args,
			],
			{
				encoding: "utf8",
				timeout: 60000,
				maxBuffer: 8 * 1024 * 1024,
				env: { ...process.env, DATABASE_URL: url.toString() },
			},
		),
	) as Report;
}

describe("refund description backfill CLI", () => {
	beforeEach(async () => {
		await db
			.insert(tables.organization)
			.values(
				ORGS.map((id) => ({
					id,
					name: "Test Organization",
					billingEmail: "test@example.com",
				})),
			);
		await db.insert(tables.transaction).values([
			{
				id: "backfill-original",
				organizationId: ORGS[0],
				type: "dev_plan_start",
				amount: "20",
				description: "DevPass Pro",
			},
			{
				id: "backfill-foreign-original",
				organizationId: ORGS[1],
				type: "chat_plan_start",
				amount: "20",
				description: "Other organization's purchase",
			},
			{
				id: "backfill-partial",
				organizationId: ORGS[0],
				type: "credit_refund",
				amount: "5",
				description: "Credit refund [backfilled]",
				relatedTransactionId: "backfill-original",
			},
			{
				id: "backfill-full",
				organizationId: ORGS[0],
				type: "credit_refund",
				amount: "20",
				description: "Credit refund",
				relatedTransactionId: "backfill-original",
			},
			{
				id: "backfill-no-link",
				organizationId: ORGS[0],
				type: "credit_refund",
				amount: "5",
				description: "Keep legacy wording",
			},
			{
				id: "backfill-missing",
				organizationId: ORGS[0],
				type: "credit_refund",
				amount: "5",
				description: "Keep legacy wording",
				relatedTransactionId: "missing-original",
			},
			{
				id: "backfill-cross-org",
				organizationId: ORGS[0],
				type: "credit_refund",
				amount: "5",
				description: "Keep legacy wording",
				relatedTransactionId: "backfill-foreign-original",
			},
			{
				id: "backfill-other-refund",
				organizationId: ORGS[1],
				type: "credit_refund",
				amount: "20",
				description: "Do not modify",
				relatedTransactionId: "backfill-foreign-original",
			},
		]);
	});
	afterEach(async () => {
		await db
			.delete(tables.transaction)
			.where(inArray(tables.transaction.organizationId, ORGS));
		await db
			.delete(tables.organization)
			.where(inArray(tables.organization.id, ORGS));
	});

	it("dry-runs without writes and commits only same-org descriptions idempotently", async () => {
		const before = await db.query.transaction.findMany({
			where: { organizationId: { in: ORGS } },
			orderBy: { id: "asc" },
		});
		const dry = runBackfill();
		expect(dry.changes).toHaveLength(2);
		expect(dry.skipped).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "backfill-no-link",
					reason: "no_related_transaction",
				}),
				expect.objectContaining({
					id: "backfill-missing",
					reason: "original_missing",
				}),
				expect.objectContaining({
					id: "backfill-cross-org",
					reason: "original_organization_mismatch",
				}),
			]),
		);
		expect(
			await db.query.transaction.findMany({
				where: { organizationId: { in: ORGS } },
				orderBy: { id: "asc" },
			}),
		).toEqual(before);
		const applied = runBackfill("--commit");
		expect(applied.changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "backfill-partial",
					after: "Partial refund (25.0%): DevPass Pro [backfilled]",
				}),
				expect.objectContaining({
					id: "backfill-full",
					after: "Refund: DevPass Pro",
				}),
			]),
		);
		const after = await db.query.transaction.findMany({
			where: { organizationId: { in: ORGS } },
			orderBy: { id: "asc" },
		});
		expect(
			after.map((row, index) => ({
				...row,
				description: before[index].description,
				updatedAt: before[index].updatedAt,
			})),
		).toEqual(before);
		for (const row of after.filter(
			(row) => !applied.changes.some((change) => change.id === row.id),
		)) {
			expect(row).toEqual(before.find((original) => original.id === row.id));
		}
		for (const change of applied.changes) {
			expect(after.find((row) => row.id === change.id)?.description).toBe(
				change.after,
			);
		}
		const repeated = runBackfill("--commit");
		expect(repeated.changes).toEqual([]);
		expect(repeated.upToDate).toBe(2);
	}, 120000);

	it("flushes large JSON reports through a pipe", async () => {
		await db
			.update(tables.transaction)
			.set({ description: "Purchase ".repeat(20000) })
			.where(eq(tables.transaction.id, "backfill-original"));
		const report = runBackfill();
		expect(report.changes).toHaveLength(2);
		expect(report.changes.every((change) => change.after.length > 100000)).toBe(
			true,
		);
	}, 60000);

	it("caps examined rows", () => {
		const report = runBackfill("--limit=1");
		expect(
			report.changes.length + report.skipped.length + report.upToDate,
		).toBe(1);
	}, 60000);
});
