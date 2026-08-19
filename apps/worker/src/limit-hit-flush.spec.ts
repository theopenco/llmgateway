import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { flushLimitHits, recordLimitHit } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { and, db, eq, inArray, tables } from "@llmgateway/db";
import { limitHitsKey, spendUtcDateKey } from "@llmgateway/shared";

// Integration test of the Redis-buffered limit-hit pipeline against the real
// test database and Redis: record → flush → additive re-flush.
describe("limit-hit flush", () => {
	const orgId = "limit-hit-test-org";
	const now = Date.now();
	const dayKey = spendUtcDateKey(now);
	const day = new Date(`${dayKey}T00:00:00.000Z`);

	async function cleanup() {
		await redisClient.del(
			limitHitsKey(dayKey),
			`${limitHitsKey(dayKey)}:flushing`,
			limitHitsKey(spendUtcDateKey(now - 86_400_000)),
			`${limitHitsKey(spendUtcDateKey(now - 86_400_000))}:flushing`,
		);
		await db
			.delete(tables.orgLimitHitDaily)
			.where(inArray(tables.orgLimitHitDaily.organizationId, [orgId]));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, orgId));
	}

	beforeEach(async () => {
		await cleanup();
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Limit Hit Test Org",
			billingEmail: "limit-hit-test@example.com",
		});
	});

	afterAll(async () => {
		await cleanup();
	});

	async function rows() {
		return await db.query.orgLimitHitDaily.findMany({
			where: {
				organizationId: {
					eq: orgId,
				},
			},
			orderBy: {
				limitType: "asc",
			},
		});
	}

	test("records and flushes counts per limit type and endpoint", async () => {
		await recordLimitHit({
			organizationId: orgId,
			limitType: "rpm",
			endpointKey: "chat_completions",
			now,
		});
		await recordLimitHit({
			organizationId: orgId,
			limitType: "rpm",
			endpointKey: "chat_completions",
			now,
		});
		await recordLimitHit({
			organizationId: orgId,
			limitType: "spend_cap_daily",
			now,
		});
		await recordLimitHit({
			organizationId: orgId,
			limitType: "topup_velocity",
			blockedUsd: 52.5,
			now,
		});

		const flushed = await flushLimitHits(now);
		expect(flushed).toBeGreaterThanOrEqual(3);

		const stored = await rows();
		const rpm = stored.find((r) => r.limitType === "rpm");
		expect(rpm).toMatchObject({
			endpointKey: "chat_completions",
			hitCount: 2,
		});
		expect(rpm?.day.getTime()).toBe(day.getTime());
		expect(
			stored.find((r) => r.limitType === "spend_cap_daily")?.hitCount,
		).toBe(1);
		const topup = stored.find((r) => r.limitType === "topup_velocity");
		expect(topup?.hitCount).toBe(1);
		expect(Number(topup?.blockedUsd)).toBeCloseTo(52.5);

		// The live buffer is fully drained.
		expect(await redisClient.exists(limitHitsKey(dayKey))).toBe(0);
		expect(await redisClient.exists(`${limitHitsKey(dayKey)}:flushing`)).toBe(
			0,
		);
	});

	test("re-flush is additive on the same day bucket", async () => {
		await recordLimitHit({
			organizationId: orgId,
			limitType: "topup_velocity",
			blockedUsd: 100,
			now,
		});
		await flushLimitHits(now);
		await recordLimitHit({
			organizationId: orgId,
			limitType: "topup_velocity",
			blockedUsd: 25,
			now,
		});
		await flushLimitHits(now);

		const stored = await db.query.orgLimitHitDaily.findFirst({
			where: {
				organizationId: { eq: orgId },
				limitType: { eq: "topup_velocity" },
			},
		});
		expect(stored?.hitCount).toBe(2);
		expect(Number(stored?.blockedUsd)).toBeCloseTo(125);
	});

	test("drops hits for organizations that no longer exist", async () => {
		await recordLimitHit({
			organizationId: "limit-hit-ghost-org",
			limitType: "rpm",
			endpointKey: "models",
			now,
		});
		await recordLimitHit({
			organizationId: orgId,
			limitType: "rpm",
			endpointKey: "models",
			now,
		});

		await flushLimitHits(now);

		const ghost = await db.query.orgLimitHitDaily.findFirst({
			where: {
				organizationId: { eq: "limit-hit-ghost-org" },
			},
		});
		expect(ghost).toBeUndefined();
		const real = await db
			.select()
			.from(tables.orgLimitHitDaily)
			.where(
				and(
					eq(tables.orgLimitHitDaily.organizationId, orgId),
					eq(tables.orgLimitHitDaily.limitType, "rpm"),
				),
			);
		expect(real).toHaveLength(1);
	});

	test("drains a leftover :flushing key from a crashed run", async () => {
		await recordLimitHit({
			organizationId: orgId,
			limitType: "spend_cap_monthly",
			now,
		});
		// Simulate a crash after RENAME but before the upsert.
		await redisClient.rename(
			limitHitsKey(dayKey),
			`${limitHitsKey(dayKey)}:flushing`,
		);

		await flushLimitHits(now);

		const stored = await db.query.orgLimitHitDaily.findFirst({
			where: {
				organizationId: { eq: orgId },
				limitType: { eq: "spend_cap_monthly" },
			},
		});
		expect(stored?.hitCount).toBe(1);
		expect(await redisClient.exists(`${limitHitsKey(dayKey)}:flushing`)).toBe(
			0,
		);
	});
});
