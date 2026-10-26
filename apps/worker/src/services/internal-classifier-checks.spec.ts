import { describe, expect, it } from "vitest";

import { buildInternalClassifierCheckRows } from "./internal-classifier-checks.js";

import type { LogInsertData } from "@llmgateway/db";

const baseLog: LogInsertData = {
	requestId: "req-1",
	organizationId: "org-1",
	projectId: "project-1",
	apiKeyId: "key-1",
	duration: 100,
	requestedModel: "gpt-4o-mini",
	usedModel: "openai/gpt-4o-mini",
	usedProvider: "openai",
	responseSize: 0,
	mode: "credits",
	usedMode: "credits",
};

describe("buildInternalClassifierCheckRows", () => {
	it("returns nothing without internal classifier verdicts", () => {
		expect(buildInternalClassifierCheckRows(baseLog)).toEqual([]);
		expect(
			buildInternalClassifierCheckRows({
				...baseLog,
				gatewayContentFilterResponse: [
					{ model: "omni-moderation-latest", results: [{ flagged: true }] },
				],
			}),
		).toEqual([]);
	});

	it("derives decision and rule for verdicts without them, like the audit CSV", () => {
		const rows = buildInternalClassifierCheckRows({
			...baseLog,
			gatewayContentFilterEvaluation: {
				sampled: true,
				provider: "openai",
				tier: 2,
				overridden: false,
				level: "strict",
				violation: true,
				action: "logged",
				enforced: false,
				flagged: true,
				matchedCategories: ["malware_cyber"],
				categoryScores: { malware_cyber: 1 },
				moderationFailed: false,
				classifier: "internal",
				internalScope: "latest_turn",
			},
			gatewayContentFilterResponse: [
				{
					model: "internal-classifier",
					results: [
						{
							tags: ["malware_cyber"],
							block: true,
							score: 0.9,
							reasons: ["cyber_model_high_confidence", "signal:malware"],
						},
						{ tags: ["sexual_content"], block: false, score: 0.2 },
					],
				},
			],
		});
		expect(rows).toEqual([
			expect.objectContaining({
				chunkIndex: 0,
				decision: "block",
				rule: "cyber_model_high_confidence",
				internalScope: "latest_turn",
				tier: 2,
				level: "strict",
				action: "logged",
				saltId: null,
				simhash: null,
			}),
			expect.objectContaining({
				chunkIndex: 1,
				decision: "allow",
				rule: "",
				reasons: [],
				tags: ["sexual_content"],
			}),
		]);
	});

	it("reads null fields as absent", () => {
		const rows = buildInternalClassifierCheckRows({
			...baseLog,
			gatewayContentFilterResponse: [
				{
					model: "internal-classifier",
					results: [
						{ block: false, score: null, reasons: null, fingerprint: null },
					],
				},
			],
		});
		expect(rows).toEqual([
			expect.objectContaining({
				decision: "allow",
				score: null,
				reasons: [],
				saltId: null,
			}),
		]);
	});

	it("skips a malformed verdict and keeps the rest", () => {
		const rows = buildInternalClassifierCheckRows({
			...baseLog,
			gatewayContentFilterResponse: [
				{
					model: "internal-classifier",
					results: [
						{ block: false, fingerprint: { simhash: 123 } },
						{ block: false, decision: "allow" },
					],
				},
			],
		});
		expect(rows).toEqual([
			expect.objectContaining({ chunkIndex: 1, decision: "allow" }),
		]);
	});
});
