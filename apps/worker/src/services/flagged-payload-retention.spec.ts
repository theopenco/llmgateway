import { afterEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import {
	getFlaggedPayloadExpiry,
	getReportedFlaggedPayloadExpiry,
} from "@llmgateway/shared/flagged-payload";

import { cleanupExpiredFlaggedPayloads } from "./flagged-payload-retention.js";

const ORG = "retention-flagged-org";
const DAY_MS = 86_400_000;

function row(id: string, createdAt: Date, reportedAt: Date | null = null) {
	const expiresAt = getFlaggedPayloadExpiry(createdAt);
	return {
		id,
		createdAt,
		requestId: `req-${id}`,
		organizationId: ORG,
		projectId: "project",
		apiKeyId: "key",
		endpoint: "chat",
		provider: "openai",
		classifier: "openai",
		tier: 0,
		level: "strict",
		action: "blocked",
		matchedGroups: ["csam"],
		matchedCategories: ["sexual/minors"],
		categoryScores: { "sexual/minors": 0.5 },
		payloadCiphertext: "llmgw:cfp1:test",
		payloadBytes: 10,
		reportedAt,
		expiresAt: reportedAt
			? getReportedFlaggedPayloadExpiry(reportedAt, expiresAt)
			: expiresAt,
	};
}

describe("cleanupExpiredFlaggedPayloads", () => {
	afterEach(async () => {
		await db
			.delete(tables.contentFilterFlaggedPayload)
			.where(eq(tables.contentFilterFlaggedPayload.organizationId, ORG));
	});

	test("deletes rows past 90 days and keeps reported ones for a year", async () => {
		const now = new Date("2026-11-18T00:00:00Z");
		const daysAgo = (days: number) => {
			const offsetMs = days * DAY_MS;
			return new Date(now.getTime() - offsetMs);
		};
		await db
			.insert(tables.contentFilterFlaggedPayload)
			.values([
				row("fresh", daysAgo(10)),
				row("expired", daysAgo(91)),
				row("reported", daysAgo(200), daysAgo(150)),
				row("reported-expired", daysAgo(500), daysAgo(400)),
			]);

		expect(await cleanupExpiredFlaggedPayloads(now)).toBe(2);

		const remaining = await db
			.select({ id: tables.contentFilterFlaggedPayload.id })
			.from(tables.contentFilterFlaggedPayload)
			.where(eq(tables.contentFilterFlaggedPayload.organizationId, ORG));
		expect(remaining.map((r) => r.id).sort()).toEqual(["fresh", "reported"]);
	});

	test("stops when asked to", async () => {
		const now = new Date("2026-11-18T00:00:00Z");
		const createdAt = new Date("2026-08-01T00:00:00Z");
		await db
			.insert(tables.contentFilterFlaggedPayload)
			.values(row("expired", createdAt));
		expect(await cleanupExpiredFlaggedPayloads(now, () => true)).toBe(0);
	});
});

describe("flagged payload expiry", () => {
	test("never shortens the hold when reported", () => {
		const createdAt = new Date("2026-01-01T00:00:00Z");
		const expiresAt = getFlaggedPayloadExpiry(createdAt);
		expect(expiresAt.toISOString()).toBe("2026-04-01T00:00:00.000Z");
		expect(
			getReportedFlaggedPayloadExpiry(
				new Date("2026-01-02T00:00:00Z"),
				expiresAt,
			).toISOString(),
		).toBe("2027-01-02T00:00:00.000Z");
		const later = new Date("2030-01-01T00:00:00Z");
		expect(
			getReportedFlaggedPayloadExpiry(new Date("2026-01-02T00:00:00Z"), later),
		).toBe(later);
	});
});
