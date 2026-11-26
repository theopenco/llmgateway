import { describe, expect, it } from "vitest";

import { models, type ModelDefinition } from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

import { getContentMentions, mentionsModel } from "./content-mentions";

// A model whose id is the prefix of a longer model id, e.g. "gpt-4o" and
// "gpt-4o-mini": the case a naive substring match gets wrong.
const ids = (models as readonly ModelDefinition[])
	.filter((model) =>
		model.providers.some((mapping) => !isMappingDeactivated(mapping)),
	)
	.map((model) => model.id as string);
const base = ids.find((id) => ids.some((other) => other.startsWith(`${id}-`)))!;
const extended = ids.find((id) => id.startsWith(`${base}-`))!;

describe("content mentions", () => {
	it("does not count a longer model id as a mention of its prefix", () => {
		const content = `We tested ${extended} on this workload.`;
		expect(mentionsModel(content, extended)).toBe(true);
		expect(mentionsModel(content, base)).toBe(false);
	});

	it("matches a model id or provider name that ends a sentence", () => {
		const mentions = getContentMentions(`Use ${base}. It runs on OpenAI.`);
		expect(mentions.models.map((link) => link.href)).toContain(
			`/models/${encodeURIComponent(base)}`,
		);
		expect(mentions.providers.map((link) => link.label)).toContain("OpenAI");
	});

	it("links a model named by id", () => {
		const mentions = getContentMentions(`Requests go to ${base} by default.`);
		expect(mentions.models.map((link) => link.href)).toContain(
			`/models/${encodeURIComponent(base)}`,
		);
	});

	it("returns nothing for text that names no model or provider", () => {
		const mentions = getContentMentions("A post about office furniture.");
		expect(mentions.models).toEqual([]);
		expect(mentions.providers).toEqual([]);
		expect(mentions.comparisons).toEqual([]);
	});
});
