import { describe, expect, it } from "vitest";

import { checkTopicRestriction } from "./topic-restriction.js";

const check = (content: string, blockedTopics: string[]) =>
	checkTopicRestriction(
		content,
		{ type: "topic_restriction", blockedTopics },
		"block",
	).passed;

describe("checkTopicRestriction", () => {
	it("does not match keywords inside other words", () => {
		expect(check("This role needs strong skills", ["violence"])).toBe(true);
		expect(check("Is option A better?", ["gambling"])).toBe(true);
		expect(check("Join our hackathon", ["illegal_activities"])).toBe(true);
		expect(check("Flights to Stockholm", ["financial_advice"])).toBe(true);
	});

	it("matches keywords and their inflections", () => {
		expect(check("He was killed", ["violence"])).toBe(false);
		expect(check("Who voted in the election?", ["politics"])).toBe(false);
		expect(check("Best casino bonus", ["gambling"])).toBe(false);
	});

	it("matches unknown topics as a phrase", () => {
		expect(check("Tell me about crypto airdrops", ["crypto airdrops"])).toBe(
			false,
		);
		expect(check("Tell me about cryptography", ["crypto"])).toBe(true);
	});
});
