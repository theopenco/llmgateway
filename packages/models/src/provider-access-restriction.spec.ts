import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import {
	isProviderMappingAllowedByRestriction,
	parseProviderAccessMappingRef,
	type ProviderAccessRestriction,
} from "./provider-access-restriction.js";

const restriction = (
	overrides: Partial<ProviderAccessRestriction>,
): ProviderAccessRestriction => ({
	mode: "deny",
	providers: [],
	models: [],
	mappings: [],
	...overrides,
});

describe("isProviderMappingAllowedByRestriction", () => {
	it("allows everything without a restriction", () => {
		expect(
			isProviderMappingAllowedByRestriction(null, "openai", "gpt-4o"),
		).toBe(true);
	});

	it("allows every catalogue mapping without a restriction", () => {
		for (const model of models) {
			for (const mapping of model.providers) {
				expect(
					isProviderMappingAllowedByRestriction(
						undefined,
						mapping.providerId,
						model.id,
					),
				).toBe(true);
				expect(
					isProviderMappingAllowedByRestriction(
						null,
						mapping.providerId,
						model.id,
					),
				).toBe(true);
			}
		}
	});

	it("deny mode blocks matching providers, models and mappings", () => {
		const deny = restriction({
			providers: ["openai"],
			models: ["claude-haiku-4-5"],
			mappings: ["google-vertex/gemini-2.5-pro"],
		});
		expect(
			isProviderMappingAllowedByRestriction(deny, "openai", "gpt-4o"),
		).toBe(false);
		expect(
			isProviderMappingAllowedByRestriction(
				deny,
				"aws-bedrock",
				"claude-haiku-4-5",
			),
		).toBe(false);
		expect(
			isProviderMappingAllowedByRestriction(
				deny,
				"google-vertex",
				"gemini-2.5-pro",
			),
		).toBe(false);
		expect(
			isProviderMappingAllowedByRestriction(
				deny,
				"google-ai-studio",
				"gemini-2.5-pro",
			),
		).toBe(true);
	});

	it("allow mode only permits matching entries", () => {
		const allow = restriction({ mode: "allow", mappings: ["openai/gpt-4o"] });
		expect(
			isProviderMappingAllowedByRestriction(allow, "openai", "gpt-4o"),
		).toBe(true);
		expect(
			isProviderMappingAllowedByRestriction(allow, "azure", "gpt-4o"),
		).toBe(false);
	});

	it("never restricts the routing pseudo-models", () => {
		const allow = restriction({ mode: "allow", providers: ["openai"] });
		expect(
			isProviderMappingAllowedByRestriction(allow, "llmgateway", "auto"),
		).toBe(true);
		expect(
			isProviderMappingAllowedByRestriction(allow, "llmgateway", "custom"),
		).toBe(false);
	});
});

describe("parseProviderAccessMappingRef", () => {
	it("splits at the first slash", () => {
		expect(
			parseProviderAccessMappingRef("together/meta-llama/llama-3"),
		).toEqual({
			providerId: "together",
			modelId: "meta-llama/llama-3",
		});
		expect(parseProviderAccessMappingRef("openai")).toBeUndefined();
		expect(parseProviderAccessMappingRef("/gpt-4o")).toBeUndefined();
		expect(parseProviderAccessMappingRef("openai/")).toBeUndefined();
	});
});
