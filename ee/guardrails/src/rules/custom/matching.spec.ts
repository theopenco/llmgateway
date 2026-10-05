import { describe, expect, it } from "vitest";

import { checkBlockedTerms } from "./blocked-terms.js";
import { checkTopicRestriction } from "./topic-restriction.js";

describe("custom guardrail matching", () => {
	it.each(["C++", ".NET", "東京", "#private"])(
		"matches the complete term %s",
		(term) => {
			expect(
				checkBlockedTerms(
					`Discuss ${term} today`,
					{
						type: "blocked_terms",
						terms: [term],
						matchType: "exact",
						caseSensitive: false,
					},
					"block",
				).passed,
			).toBe(false);
		},
	);

	it("does not match an exact term inside another word", () => {
		expect(
			checkBlockedTerms(
				"a devoted developer",
				{
					type: "blocked_terms",
					terms: ["vote"],
					matchType: "exact",
					caseSensitive: false,
				},
				"block",
			).passed,
		).toBe(true);
	});

	it("does not infer restricted topics from fragments of unrelated words", () => {
		expect(
			checkTopicRestriction(
				"A devoted team with skills and a better plan",
				{
					type: "topic_restriction",
					blockedTopics: ["politics", "violence", "gambling"],
				},
				"block",
			).passed,
		).toBe(true);
	});

	it.each([
		["bombs", "violence"],
		["weapons", "violence"],
		["stabbing", "violence"],
		["elections", "politics"],
		["voting", "politics"],
		["hacking", "illegal_activities"],
		["gambling", "gambling"],
		["custom topics", "custom topic"],
	])("matches the inflection %s for %s", (text, topic) => {
		expect(
			checkTopicRestriction(
				`Tell me about ${text}.`,
				{ type: "topic_restriction", blockedTopics: [topic] },
				"block",
			).passed,
		).toBe(false);
	});

	it.each([
		["between", "gambling"],
		["goddess", "religion"],
		["hackathon", "illegal_activities"],
	])("does not match %s for %s", (text, topic) => {
		expect(
			checkTopicRestriction(
				`Tell me about ${text}.`,
				{ type: "topic_restriction", blockedTopics: [topic] },
				"block",
			).passed,
		).toBe(true);
	});

	it("still matches whole topic keywords and multiword phrases", () => {
		expect(
			checkTopicRestriction(
				"Discuss the election and government policy",
				{
					type: "topic_restriction",
					blockedTopics: ["politics"],
				},
				"block",
			).passed,
		).toBe(false);
	});
});
