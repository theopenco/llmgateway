import { createHash } from "node:crypto";

import { afterEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";
import { decryptFlaggedPayload } from "@llmgateway/shared/flagged-payload-crypto";

import {
	buildFlaggedPayload,
	getPreservedFlaggedGroups,
	storeFlaggedPayload,
} from "./flagged-payload.js";

import type { TieredContentFilterPlan } from "./tiered-content-filter.js";
import type { GatewayContentFilterEvaluation } from "@llmgateway/db";
import type { BaseMessage } from "@llmgateway/models";
import type { FlaggedPayload } from "@llmgateway/shared/flagged-payload";

const plan: TieredContentFilterPlan = {
	provider: "openai",
	tier: 0,
	overridden: false,
	level: "strict",
	enforce: true,
	classifier: "openai",
	shadowClassifiers: [],
	internalScope: "full",
	moderateImages: true,
	blockGroups: ["csam", "sexual"],
	csamScoreThreshold: 0.01,
	preserveFlaggedPayloads: true,
};

function evaluation(
	overrides: Partial<GatewayContentFilterEvaluation> = {},
): GatewayContentFilterEvaluation {
	return {
		sampled: true,
		classifier: "openai",
		provider: "openai",
		tier: 0,
		overridden: false,
		level: "strict",
		violation: true,
		action: "blocked",
		enforced: true,
		flagged: true,
		matchedCategories: ["sexual/minors"],
		matchedGroups: ["csam"],
		categoryScores: { "sexual/minors": 0.4 },
		moderationFailed: false,
		durationMs: 10,
		...overrides,
	};
}

describe("getPreservedFlaggedGroups", () => {
	test("keeps csam and sexual matches, blocked or only logged", () => {
		expect(
			getPreservedFlaggedGroups(
				plan,
				evaluation({ matchedGroups: ["csam", "sexual", "cyber"] }),
				false,
			),
		).toEqual(["csam", "sexual"]);
		expect(
			getPreservedFlaggedGroups(
				{ preserveFlaggedPayloads: true },
				evaluation({ action: "logged", matchedGroups: ["sexual"] }),
				false,
			),
		).toEqual(["sexual"]);
	});

	test("skips other groups, passes and the disabled setting", () => {
		expect(
			getPreservedFlaggedGroups(
				plan,
				evaluation({ matchedGroups: ["cyber"] }),
				false,
			),
		).toEqual([]);
		expect(
			getPreservedFlaggedGroups(
				plan,
				evaluation({ violation: false, action: "passed" }),
				false,
			),
		).toEqual([]);
		expect(
			getPreservedFlaggedGroups(
				{ preserveFlaggedPayloads: false },
				evaluation(),
				false,
			),
		).toEqual([]);
	});

	test("keeps only csam under zero data retention", () => {
		expect(
			getPreservedFlaggedGroups(
				plan,
				evaluation({ matchedGroups: ["csam", "sexual"] }),
				true,
			),
		).toEqual(["csam"]);
		expect(
			getPreservedFlaggedGroups(
				plan,
				evaluation({ matchedGroups: ["sexual"] }),
				true,
			),
		).toEqual([]);
	});
});

describe("buildFlaggedPayload", () => {
	const imageBytes = Buffer.from("not really a png, but bytes all the same");
	const imageBase64 = imageBytes.toString("base64");

	test("keeps text and replaces inline media with a hash", () => {
		const messages: BaseMessage[] = [
			{ role: "system", content: "be helpful" },
			{
				role: "user",
				content: [
					{ type: "text", text: "describe this" },
					{
						type: "image_url",
						image_url: { url: `data:image/png;base64,${imageBase64}` },
					},
					{
						type: "image_url",
						image_url: {
							url: "https://user:secret@example.com/a.png?sig=token#frag",
						},
					},
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: imageBase64,
						},
					},
				],
			},
		];
		const result = buildFlaggedPayload(messages);
		expect(result.json.includes(imageBase64)).toBe(false);
		expect(result.json.includes("secret")).toBe(false);
		expect(result.truncated).toBe(false);
		expect(result.imageCount).toBe(3);
		const payload = JSON.parse(result.json) as FlaggedPayload;
		const hash = createHash("sha256").update(imageBytes).digest("hex");
		expect(payload.messages[1].content).toEqual([
			{ type: "text", text: "describe this" },
			{
				type: "image",
				sha256: hash,
				bytes: imageBytes.length,
				mimeType: "image/png",
			},
			{
				type: "image",
				url: "https://example.com/a.png",
				urlSha256: createHash("sha256")
					.update("https://user:secret@example.com/a.png?sig=token#frag")
					.digest("hex"),
			},
			{
				type: "image",
				sha256: hash,
				bytes: imageBytes.length,
				mimeType: "image/jpeg",
			},
		]);
	});

	test("hashes media nested in tool inputs and results", () => {
		const longBase64 = Buffer.alloc(2048, 7).toString("base64");
		const result = buildFlaggedPayload([
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call-1",
						name: "upload",
						input: { file: `data:image/png;base64,${imageBase64}` },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: [
							{ type: "text", text: "tool says hi" },
							{
								type: "image",
								source: {
									type: "base64",
									media_type: "image/png",
									data: longBase64,
								},
							},
						],
					},
				],
			},
		]);
		expect(result.json.includes(imageBase64)).toBe(false);
		expect(result.json.includes(longBase64)).toBe(false);
		expect(result.json.includes("tool says hi")).toBe(true);
		const payload = JSON.parse(result.json) as FlaggedPayload;
		expect(payload.messages[0].content).toEqual([
			{
				type: "tool_use",
				name: "upload",
				input: {
					file: {
						type: "media",
						sha256: createHash("sha256").update(imageBytes).digest("hex"),
						bytes: imageBytes.length,
						mimeType: "image/png",
					},
				},
			},
		]);
	});

	test("drops the oldest messages first to fit the cap", () => {
		const messages: BaseMessage[] = [
			{ role: "user", content: "a".repeat(600) },
			{ role: "assistant", content: "b".repeat(600) },
			{ role: "user", content: "latest turn" },
		];
		const result = buildFlaggedPayload(messages, 1000);
		const payload = JSON.parse(result.json) as FlaggedPayload;
		expect(result.truncated).toBe(true);
		expect(result.bytes).toBeLessThanOrEqual(1000);
		expect(payload.droppedMessages).toBe(1);
		expect(payload.messages.at(-1)?.content).toBe("latest turn");
	});

	test("cuts a single message larger than the cap", () => {
		for (const content of ["x".repeat(5000), '"\\'.repeat(2500)]) {
			const result = buildFlaggedPayload([{ role: "user", content }], 1000);
			expect(result.truncated).toBe(true);
			expect(result.bytes).toBeLessThanOrEqual(1000);
			expect(JSON.parse(result.json).messages).toHaveLength(1);
		}
	});
});

describe("storeFlaggedPayload", () => {
	afterEach(async () => {
		await db
			.delete(tables.contentFilterFlaggedPayload)
			.where(
				eq(tables.contentFilterFlaggedPayload.organizationId, "flagged-org"),
			);
	});

	test("writes an encrypted row that expires after 90 days", async () => {
		const now = new Date("2026-11-01T00:00:00Z");
		const id = await storeFlaggedPayload({
			plan,
			evaluation: evaluation({ action: "logged" }),
			messages: [{ role: "user", content: "the flagged prompt" }],
			context: {
				requestId: "req-flagged",
				organizationId: "flagged-org",
				projectId: "flagged-project",
				apiKeyId: "flagged-key",
			},
			origin: { endpoint: "chat", model: "gpt-4o", zeroDataRetention: false },
			groups: ["csam"],
			now,
		});
		const row = await db.query.contentFilterFlaggedPayload.findFirst({
			where: { id: { eq: id } },
		});
		expect(row).toMatchObject({
			requestId: "req-flagged",
			endpoint: "chat",
			model: "gpt-4o",
			action: "logged",
			matchedGroups: ["csam"],
			expiresAt: new Date("2027-01-30T00:00:00Z"),
			reportedAt: null,
		});
		expect(row?.payloadCiphertext.includes("flagged prompt")).toBe(false);
		const payload = JSON.parse(
			decryptFlaggedPayload(row!.payloadCiphertext, id, "flagged-org"),
		) as FlaggedPayload;
		expect(payload.messages).toEqual([
			{ role: "user", content: "the flagged prompt" },
		]);
	});
});
