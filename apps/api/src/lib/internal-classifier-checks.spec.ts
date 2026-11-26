import { describe, expect, it } from "vitest";

import { internalClassifierChecksFromLog } from "./internal-classifier-checks.js";

import type { ContentFilteredLogRow } from "./internal-classifier-checks.js";

const baseLog: ContentFilteredLogRow = {
	ts: "2026-10-20T12:00:00.000000Z",
	requestId: "req-1",
	organizationId: "org-1",
	projectId: "project-1",
	apiKeyId: "key-1",
	usedModel: "openai/gpt-4o-mini",
	usedProvider: "openai",
	evaluation: null,
	response: null,
};

describe("internalClassifierChecksFromLog", () => {
	it("returns nothing without internal classifier verdicts", () => {
		expect(internalClassifierChecksFromLog(baseLog)).toEqual([]);
		expect(
			internalClassifierChecksFromLog({
				...baseLog,
				response: [
					{ model: "omni-moderation-latest", results: [{ flagged: true }] },
				],
			}),
		).toEqual([]);
	});

	it("derives decision and rule for verdicts without them, like the audit CSV", () => {
		const rows = internalClassifierChecksFromLog({
			...baseLog,
			evaluation: {
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
			response: [
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
		const rows = internalClassifierChecksFromLog({
			...baseLog,
			response: [
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
		const rows = internalClassifierChecksFromLog({
			...baseLog,
			response: [
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
