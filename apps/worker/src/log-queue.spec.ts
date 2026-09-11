import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOG_QUEUE, publishToQueue, redisClient } from "@llmgateway/cache";
import { db, inArray, log } from "@llmgateway/db";

import { logInsertCircuit, processLogQueue } from "./worker.js";

import type { LogInsertData } from "@llmgateway/db";

describe("processLogQueue", () => {
	let logIds: string[] = [];

	beforeEach(async () => {
		logIds = [];
		logInsertCircuit.consecutiveFailures = 0;
		logInsertCircuit.nextAttemptAt = 0;
		await redisClient.del(LOG_QUEUE);
	});

	afterEach(async () => {
		await redisClient.del(LOG_QUEUE);
		if (logIds.length > 0) {
			await db.delete(log).where(inArray(log.id, logIds));
		}
	});

	it("rounds fractional token limits up when inserting a batch of logs", async () => {
		const baseLog: LogInsertData = {
			requestId: "request-id",
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: "api-key-id",
			duration: 100,
			requestedModel: "gpt-4o-mini",
			usedModel: "gpt-4o-mini",
			usedProvider: "openai",
			responseSize: 0,
			mode: "credits",
			usedMode: "credits",
		};
		const fractionalId = randomUUID();
		const validId = randomUUID();
		const unsetId = randomUUID();
		logIds.push(fractionalId, validId, unsetId);
		await publishToQueue(LOG_QUEUE, {
			...baseLog,
			id: fractionalId,
			maxTokens: 128.5,
			reasoningMaxTokens: 64.25,
			hasError: true,
			finishReason: "client_error",
		});
		await publishToQueue(LOG_QUEUE, {
			...baseLog,
			id: validId,
			maxTokens: 1024,
			reasoningMaxTokens: 512,
			promptTokens: "12.5",
		});
		await publishToQueue(LOG_QUEUE, {
			...baseLog,
			id: unsetId,
			maxTokens: null,
		});

		expect(await processLogQueue()).toBe(3);
		expect(await redisClient.llen(LOG_QUEUE)).toBe(0);
		expect(logInsertCircuit.consecutiveFailures).toBe(0);
		const rows = await db.query.log.findMany({
			where: { id: { in: logIds } },
		});
		expect(rows).toHaveLength(3);
		expect(rows.find((row) => row.id === fractionalId)).toMatchObject({
			maxTokens: 129,
			reasoningMaxTokens: 65,
			hasError: true,
			finishReason: "client_error",
		});
		expect(rows.find((row) => row.id === validId)).toMatchObject({
			maxTokens: 1024,
			reasoningMaxTokens: 512,
			promptTokens: "12.5",
		});
		expect(rows.find((row) => row.id === unsetId)).toMatchObject({
			maxTokens: null,
			reasoningMaxTokens: null,
		});
	});
});
