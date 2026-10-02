import { expect, it } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import { getTopUpVelocityUsage } from "./topup-velocity.js";

it("counts positive top-ups without subtracting reversal entries", async () => {
	const id = `gross-topup-${crypto.randomUUID()}`;
	await db
		.insert(tables.organization)
		.values({ id, name: "Top-up test", billingEmail: "topup@example.com" });
	try {
		await db.insert(tables.transaction).values(
			[100, -80].map((amount) => ({
				organizationId: id,
				type: "credit_topup" as const,
				status: "completed" as const,
				amount: String(amount),
			})),
		);
		expect((await getTopUpVelocityUsage(id)).dbSumUsd).toBe(100);
	} finally {
		await db.delete(tables.organization).where(eq(tables.organization.id, id));
	}
});
