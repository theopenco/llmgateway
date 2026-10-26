import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOG_QUEUE, publishToQueue, redisClient } from "@llmgateway/cache";
import { db, inArray, log, tables } from "@llmgateway/db";

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
		await db
			.delete(tables.internalClassifierCheck)
			.where(
				inArray(tables.internalClassifierCheck.requestId, ["cf-check-request"]),
			);
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

	it("records every internal classifier verdict once, with its fingerprint", async () => {
		const fingerprint = {
			salt_id: "default",
			algo_version: 1,
			fp_status: "ok",
			prompt_bytes: 113,
			simhash: "-121594583441436065",
			simhash_global: "-2619368671083822859",
			exact_hash: "-4277168721033277467",
			conversation_key: "c_65f685b18ecceb9c",
			minhash_b64: "5KR9jFdwOeCd",
			band_keys: ["-4189572804323252917", "-7653213509540500479"],
		};
		const contentFilteredLog: LogInsertData = {
			requestId: "cf-check-request",
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: "api-key-id",
			duration: 100,
			requestedModel: "gpt-4o-mini",
			usedModel: "openai/gpt-4o-mini",
			usedProvider: "openai",
			responseSize: 0,
			mode: "credits",
			usedMode: "credits",
			gatewayContentFilterResponse: [
				{
					model: "internal-classifier",
					results: [
						{
							flagged: true,
							tags: ["child_exploitation"],
							block: true,
							score: 0.9,
							reasons: ["minor_plus_sexual_conjunction", "signal:minor_age"],
							decision: "block",
							rule: "minor_plus_sexual_conjunction",
							fingerprint,
						},
						{
							flagged: false,
							tags: [],
							block: false,
							score: 0,
							decision: "allow",
							fingerprint: {
								salt_id: "default",
								algo_version: 1,
								fp_status: "too_short",
								prompt_bytes: 2,
							},
						},
					],
				},
				{ model: "omni-moderation-latest", results: [{ flagged: false }] },
			],
		};
		// A request retried across providers logs the same verdicts on the
		// failed attempt; only the final attempt's log records them.
		const retriedId = randomUUID();
		const finalId = randomUUID();
		logIds.push(retriedId, finalId);
		await publishToQueue(LOG_QUEUE, {
			...contentFilteredLog,
			id: retriedId,
			usedModel: "anthropic/claude-haiku-4-5",
			usedProvider: "anthropic",
			hasError: true,
			retried: true,
		});
		await publishToQueue(LOG_QUEUE, { ...contentFilteredLog, id: finalId });

		expect(await processLogQueue()).toBe(2);
		const checks = await db.query.internalClassifierCheck.findMany({
			where: { requestId: "cf-check-request" },
			orderBy: { chunkIndex: "asc" },
		});
		expect(checks).toHaveLength(2);
		expect(checks[0]).toMatchObject({
			chunkIndex: 0,
			organizationId: "org-id",
			usedModel: "openai/gpt-4o-mini",
			usedProvider: "openai",
			decision: "block",
			rule: "minor_plus_sexual_conjunction",
			reasons: ["minor_plus_sexual_conjunction", "signal:minor_age"],
			tags: ["child_exploitation"],
			saltId: "default",
			fpStatus: "ok",
			promptBytes: 113,
			simhash: "-121594583441436065",
			exactHash: "-4277168721033277467",
			minhashB64: "5KR9jFdwOeCd",
			bandKeys: ["-4189572804323252917", "-7653213509540500479"],
		});
		expect(checks[1]).toMatchObject({
			chunkIndex: 1,
			decision: "allow",
			fpStatus: "too_short",
			simhash: null,
			bandKeys: null,
		});
	});
});
