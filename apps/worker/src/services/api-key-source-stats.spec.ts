import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { recalculateApiKeyHourlySourceStats } from "./project-stats-aggregator.js";

const projectId = "source-stats-project";
const hour = "2026-03-01 10:00:00";

describe("per-key source aggregation", () => {
	async function cleanup() {
		await db.delete(tables.log).where(eq(tables.log.projectId, projectId));
		await db
			.delete(tables.apiKeyHourlySourceStats)
			.where(eq(tables.apiKeyHourlySourceStats.projectId, projectId));
		await db.delete(tables.project).where(eq(tables.project.id, projectId));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, "source-stats-org"));
		await db.delete(tables.user).where(eq(tables.user.id, "source-stats-user"));
	}
	beforeEach(async () => {
		await cleanup();
		await db
			.insert(tables.user)
			.values({ id: "source-stats-user", email: "source-stats@example.com" });
		await db.insert(tables.organization).values({
			id: "source-stats-org",
			name: "Test Organization",
			billingEmail: "source-stats@example.com",
			retentionLevel: "none",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "Test Project",
			organizationId: "source-stats-org",
		});
		await db.insert(tables.apiKey).values(
			["a", "b"].map((id) => ({
				id: `source-key-${id}`,
				...hashApiKeyForStorage(`source-key-${id}`),
				projectId,
				createdBy: "source-stats-user",
				description: "Test key",
			})),
		);
	});
	afterEach(cleanup);

	function insertLog(
		apiKeyId: string,
		source: string | null,
		createdAt = "2026-03-01T10:10:00Z",
		usedMode: "credits" | "api-keys" = "credits",
	) {
		return db.insert(tables.log).values({
			requestId: crypto.randomUUID(),
			organizationId: "source-stats-org",
			projectId,
			apiKeyId,
			createdAt: new Date(createdAt),
			source,
			cost: 0.25,
			dataStorageCost: "0.125",
			promptTokens: "10",
			completionTokens: "20",
			totalTokens: "30",
			duration: 100,
			mode: usedMode,
			usedMode,
			requestedModel: "test-model",
			usedModel: "test-model",
			usedProvider: "test-provider",
			unifiedFinishReason: "completed",
			responseSize: 100,
		});
	}

	test("keeps keys and hours separate, buckets unknown sources, and refreshes idempotently", async () => {
		await insertLog("source-key-a", "codex");
		await insertLog(
			"source-key-a",
			"codex",
			"2026-03-01T10:20:00Z",
			"api-keys",
		);
		await insertLog("source-key-b", "codex");
		await insertLog("source-key-a", null);
		await insertLog("source-key-a", "outside", "2026-03-01T11:00:00Z");
		await recalculateApiKeyHourlySourceStats(projectId, hour);
		await recalculateApiKeyHourlySourceStats(projectId, hour);
		const rows = await db.query.apiKeyHourlySourceStats.findMany({
			where: { projectId },
		});
		expect(rows).toHaveLength(3);
		expect(
			rows.find(
				(row) => row.apiKeyId === "source-key-a" && row.source === "codex",
			),
		).toMatchObject({
			requestCount: 2,
			cost: 0.5,
			creditsCost: 0.25,
			apiKeysCost: 0.25,
			dataStorageCost: 0.25,
			totalTokens: "60",
		});
		expect(rows.find((row) => row.apiKeyId === "source-key-b")).toMatchObject({
			requestCount: 1,
		});
		expect(rows.find((row) => row.source === "unknown")).toMatchObject({
			requestCount: 1,
		});
		await db.delete(tables.log).where(eq(tables.log.projectId, projectId));
		expect(
			await db.query.apiKeyHourlySourceStats.findMany({ where: { projectId } }),
		).toHaveLength(3);
	});
});
