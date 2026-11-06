import { setTimeout } from "node:timers/promises";

import { afterEach, expect, it } from "vitest";

import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, sql, tables } from "@llmgateway/db";

import { withEnterpriseSeatForOrganization } from "./enterprise-seats.js";

afterEach(deleteAll);
it("does not hold the deployment seat lock while waiting for a Pro organization", async () => {
	await createTestUser();
	for (const id of ["pro-blocked-org", "pro-unrelated-org"]) {
		await db.insert(tables.organization).values({
			id,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
			proSeats: 3,
		});
	}
	let acquired!: () => void;
	const ready = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const holder = db.transaction(async (tx) => {
		await tx
			.select()
			.from(tables.organization)
			.where(eq(tables.organization.id, "pro-blocked-org"))
			.for("no key update");
		acquired();
		await gate;
	});
	await ready;
	const blocked = withEnterpriseSeatForOrganization(
		"pro-blocked-org",
		"test-user-id",
		async () => true,
	);
	let waiting = false;
	for (let i = 0; i < 100; i++) {
		const result = await db.execute<{ blocked: boolean }>(
			sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()) AS blocked`,
		);
		if (result.rows[0]?.blocked) {
			waiting = true;
			break;
		}
		await setTimeout(10);
	}
	const unrelated = withEnterpriseSeatForOrganization(
		"pro-unrelated-org",
		"test-user-id",
		async () => true,
	);
	let progressed: boolean;
	try {
		progressed = await Promise.race([
			unrelated,
			setTimeout(500).then(() => false),
		]);
	} finally {
		release();
		await Promise.all([holder, blocked, unrelated]);
	}
	expect(waiting).toBe(true);
	expect(progressed).toBe(true);
});
