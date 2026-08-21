import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getOrganizationEnvVariant,
	getProviderEnvExclusiveGroups,
	getProviderEnvExclusiveViolations,
	getProviderEnvValue,
	getRegionSpecificEnvVarName,
	hasRegionSpecificEnvKey,
	getVariantEnvVarName,
	getVariantEnvVarNameFor,
} from "./provider.js";
import { getRegionScopedDefaultRegion } from "./providers.js";

const BASE = "LLM_ALIBABA_API_KEY";
const ENTERPRISE = `${BASE}__ENTERPRISE`;
const PLANS = `${BASE}__PLANS`;
const REGIONAL = `${BASE}__US_VIRGINIA`;
const ENTERPRISE_REGIONAL = `${BASE}__ENTERPRISE__US_VIRGINIA`;
const PLANS_REGIONAL = `${BASE}__PLANS__US_VIRGINIA`;
const VERTEX_PROJECT = "LLM_GOOGLE_CLOUD_PROJECT";

describe("variant env var helpers", () => {
	beforeEach(() => {
		for (const name of [
			BASE,
			ENTERPRISE,
			PLANS,
			REGIONAL,
			ENTERPRISE_REGIONAL,
			PLANS_REGIONAL,
			VERTEX_PROJECT,
			`${VERTEX_PROJECT}__ENTERPRISE`,
			`${VERTEX_PROJECT}__PLANS`,
		]) {
			vi.stubEnv(name, undefined);
		}
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("getVariantEnvVarName", () => {
		it("returns the variant var name only when it is set", () => {
			expect(getVariantEnvVarName("alibaba", "enterprise")).toBeUndefined();
			expect(getVariantEnvVarName("alibaba", "plans")).toBeUndefined();
			vi.stubEnv(ENTERPRISE, "sk-ent");
			vi.stubEnv(PLANS, "sk-dev");
			expect(getVariantEnvVarName("alibaba", "enterprise")).toBe(ENTERPRISE);
			expect(getVariantEnvVarName("alibaba", "plans")).toBe(PLANS);
		});

		it("returns undefined without a variant or for unknown providers", () => {
			vi.stubEnv(ENTERPRISE, "sk-ent");
			expect(getVariantEnvVarName("alibaba", undefined)).toBeUndefined();
			expect(
				getVariantEnvVarName("not-a-provider", "enterprise"),
			).toBeUndefined();
		});
	});

	describe("getVariantEnvVarNameFor", () => {
		it("applies to arbitrary env var names", () => {
			vi.stubEnv(`${VERTEX_PROJECT}__PLANS`, "plans-project");
			expect(getVariantEnvVarNameFor(VERTEX_PROJECT, "plans")).toBe(
				`${VERTEX_PROJECT}__PLANS`,
			);
			expect(
				getVariantEnvVarNameFor(VERTEX_PROJECT, "enterprise"),
			).toBeUndefined();
		});
	});

	describe("getProviderEnvValue with variant", () => {
		it("reads the variant list at the config index", () => {
			vi.stubEnv(VERTEX_PROJECT, "base-project-a,base-project-b");
			vi.stubEnv(
				`${VERTEX_PROJECT}__ENTERPRISE`,
				"ent-project-a,ent-project-b",
			);

			expect(getProviderEnvValue("google-vertex", "project", 1)).toBe(
				"base-project-b",
			);
			expect(
				getProviderEnvValue(
					"google-vertex",
					"project",
					1,
					undefined,
					"enterprise",
				),
			).toBe("ent-project-b");
			expect(
				getProviderEnvValue("google-vertex", "project", 0, undefined, "plans"),
			).toBe("base-project-a");
		});

		it("returns the default when neither variant nor base var is set", () => {
			expect(
				getProviderEnvValue("google-vertex", "region", 0, "global", "plans"),
			).toBe("global");
		});
	});

	describe("getRegionSpecificEnvVarName with variant", () => {
		it("prefers the variant-regional var for matching orgs", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			vi.stubEnv(ENTERPRISE_REGIONAL, "sk-ent-region");
			vi.stubEnv(PLANS_REGIONAL, "sk-dev-region");
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", "enterprise"),
			).toBe(ENTERPRISE_REGIONAL);
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", "plans"),
			).toBe(PLANS_REGIONAL);
		});

		it("falls back to the shared regional var when no variant-regional var is set", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", "enterprise"),
			).toBe(REGIONAL);
		});

		it("never returns a variant-regional name without a variant", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			vi.stubEnv(ENTERPRISE_REGIONAL, "sk-ent-region");
			expect(getRegionSpecificEnvVarName("alibaba", "us-virginia")).toBe(
				REGIONAL,
			);
		});

		it("returns undefined when no regional var is set, even with a plain variant var", () => {
			vi.stubEnv(ENTERPRISE, "sk-ent");
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", "enterprise"),
			).toBeUndefined();
		});
	});

	describe("getOrganizationEnvVariant", () => {
		it("maps enterprise-plan orgs to the enterprise variant", () => {
			expect(
				getOrganizationEnvVariant({
					plan: "enterprise",
					kind: "default",
					devPlan: "none",
				}),
			).toBe("enterprise");
		});

		it("maps DevPass orgs to the plans variant", () => {
			expect(
				getOrganizationEnvVariant({
					plan: "free",
					kind: "devpass",
					devPlan: "pro",
				}),
			).toBe("plans");
		});

		it("maps Chat plan orgs to the plans variant", () => {
			expect(
				getOrganizationEnvVariant({
					plan: "free",
					kind: "chat",
					devPlan: "none",
					chatPlan: "plus",
				}),
			).toBe("plans");
		});

		it("prefers enterprise when an org matches both", () => {
			expect(
				getOrganizationEnvVariant({
					plan: "enterprise",
					kind: "devpass",
					devPlan: "pro",
				}),
			).toBe("enterprise");
		});

		it("returns undefined for regular orgs, inactive plans, and missing orgs", () => {
			expect(
				getOrganizationEnvVariant({
					plan: "pro",
					kind: "default",
					devPlan: "none",
				}),
			).toBeUndefined();
			expect(
				getOrganizationEnvVariant({
					plan: "free",
					kind: "devpass",
					devPlan: "none",
				}),
			).toBeUndefined();
			expect(
				getOrganizationEnvVariant({
					plan: "free",
					kind: "chat",
					chatPlan: "none",
				}),
			).toBeUndefined();
			expect(getOrganizationEnvVariant(null)).toBeUndefined();
			expect(getOrganizationEnvVariant(undefined)).toBeUndefined();
		});
	});
});

describe("exclusive provider env groups", () => {
	it("declares Azure's resource and base URL as mutually exclusive", () => {
		const groups = getProviderEnvExclusiveGroups("azure");

		expect(groups).toHaveLength(1);
		expect(groups[0].keys).toEqual(["resource", "baseUrl"]);
	});

	it("accepts exactly one member of the group", () => {
		expect(
			getProviderEnvExclusiveViolations("azure", { resource: "my-resource" }),
		).toEqual([]);
		expect(
			getProviderEnvExclusiveViolations("azure", {
				baseUrl: "https://azure.example.internal",
			}),
		).toEqual([]);
	});

	it("rejects supplying neither", () => {
		const violations = getProviderEnvExclusiveViolations("azure", {
			apiVersion: "2025-01-01",
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("Set one of resource or baseUrl");
	});

	it("rejects supplying both", () => {
		const violations = getProviderEnvExclusiveViolations("azure", {
			resource: "my-resource",
			baseUrl: "https://azure.example.internal",
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toBe(
			"Set only one of resource or baseUrl — resource and baseUrl were both supplied.",
		);
	});

	it("treats blank and missing config alike", () => {
		expect(
			getProviderEnvExclusiveViolations("azure", { resource: "   " }),
		).toHaveLength(1);
		expect(getProviderEnvExclusiveViolations("azure", null)).toHaveLength(1);
	});

	it("leaves providers without exclusive groups unconstrained", () => {
		expect(getProviderEnvExclusiveGroups("openai")).toEqual([]);
		expect(getProviderEnvExclusiveViolations("openai", {})).toEqual([]);
	});
});

describe("hasRegionSpecificEnvKey with workspace-scoped regions", () => {
	const WORKSPACE = "LLM_ALIBABA_WORKSPACE_ID";
	const WORKSPACE_REGIONAL = `${WORKSPACE}__EU_FRANKFURT`;
	const FRANKFURT_KEY = `${BASE}__EU_FRANKFURT`;

	beforeEach(() => {
		for (const name of [BASE, FRANKFURT_KEY, WORKSPACE, WORKSPACE_REGIONAL]) {
			vi.stubEnv(name, undefined);
		}
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	// Frankfurt has a shared entry point, so the key alone makes it routable
	// and the workspace id only upgrades which host is used.
	it("considers Frankfurt available from the regional API key alone", () => {
		vi.stubEnv(FRANKFURT_KEY, "sk-frankfurt");
		expect(hasRegionSpecificEnvKey("alibaba", "eu-frankfurt")).toBe(true);
	});

	it("considers Frankfurt available with a workspace id too", () => {
		vi.stubEnv(FRANKFURT_KEY, "sk-frankfurt");
		vi.stubEnv(WORKSPACE_REGIONAL, "ws-abc123");
		expect(hasRegionSpecificEnvKey("alibaba", "eu-frankfurt")).toBe(true);
	});

	it("still requires the regional API key when only the workspace id is set", () => {
		vi.stubEnv(BASE, "sk-singapore");
		vi.stubEnv(WORKSPACE, "ws-abc123");
		expect(hasRegionSpecificEnvKey("alibaba", "eu-frankfurt")).toBe(false);
	});

	it("leaves regions with a shared host unaffected", () => {
		vi.stubEnv(`${BASE}__US_VIRGINIA`, "sk-us");
		expect(hasRegionSpecificEnvKey("alibaba", "us-virginia")).toBe(true);
	});
});

describe("getRegionScopedDefaultRegion", () => {
	// Alibaba has no global region, so a credential always belongs to exactly
	// one region and the default one serves requests that resolved none.
	it("reports the default region for a provider with region-scoped keys", () => {
		expect(getRegionScopedDefaultRegion("alibaba")).toBe("singapore");
	});

	// AWS keys are IAM-global: a region on a credential is the operator scoping
	// it, never a hint that it may stand in for the default region.
	it("reports nothing for a provider whose key works across regions", () => {
		expect(getRegionScopedDefaultRegion("aws-bedrock")).toBeUndefined();
		expect(getRegionScopedDefaultRegion("aws-mantle")).toBeUndefined();
	});

	it("reports nothing for a provider without regions", () => {
		expect(getRegionScopedDefaultRegion("openai")).toBeUndefined();
	});
});
