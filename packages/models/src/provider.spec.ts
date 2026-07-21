import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getOrganizationEnvVariant,
	getProviderEnvValue,
	getRegionSpecificEnvVarName,
	getVariantEnvVarName,
	getVariantEnvVarNameFor,
} from "./provider.js";

const BASE = "LLM_ALIBABA_API_KEY";
const ENTERPRISE = `${BASE}__ENTERPRISE`;
const DEVPASS = `${BASE}__DEVPASS`;
const REGIONAL = `${BASE}__US_VIRGINIA`;
const ENTERPRISE_REGIONAL = `${BASE}__ENTERPRISE__US_VIRGINIA`;
const DEVPASS_REGIONAL = `${BASE}__DEVPASS__US_VIRGINIA`;
const VERTEX_PROJECT = "LLM_GOOGLE_CLOUD_PROJECT";

describe("variant env var helpers", () => {
	beforeEach(() => {
		for (const name of [
			BASE,
			ENTERPRISE,
			DEVPASS,
			REGIONAL,
			ENTERPRISE_REGIONAL,
			DEVPASS_REGIONAL,
			VERTEX_PROJECT,
			`${VERTEX_PROJECT}__ENTERPRISE`,
			`${VERTEX_PROJECT}__DEVPASS`,
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
			expect(getVariantEnvVarName("alibaba", "devpass")).toBeUndefined();
			vi.stubEnv(ENTERPRISE, "sk-ent");
			vi.stubEnv(DEVPASS, "sk-dev");
			expect(getVariantEnvVarName("alibaba", "enterprise")).toBe(ENTERPRISE);
			expect(getVariantEnvVarName("alibaba", "devpass")).toBe(DEVPASS);
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
			vi.stubEnv(`${VERTEX_PROJECT}__DEVPASS`, "devpass-project");
			expect(getVariantEnvVarNameFor(VERTEX_PROJECT, "devpass")).toBe(
				`${VERTEX_PROJECT}__DEVPASS`,
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
				getProviderEnvValue(
					"google-vertex",
					"project",
					0,
					undefined,
					"devpass",
				),
			).toBe("base-project-a");
		});

		it("returns the default when neither variant nor base var is set", () => {
			expect(
				getProviderEnvValue("google-vertex", "region", 0, "global", "devpass"),
			).toBe("global");
		});
	});

	describe("getRegionSpecificEnvVarName with variant", () => {
		it("prefers the variant-regional var for matching orgs", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			vi.stubEnv(ENTERPRISE_REGIONAL, "sk-ent-region");
			vi.stubEnv(DEVPASS_REGIONAL, "sk-dev-region");
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", "enterprise"),
			).toBe(ENTERPRISE_REGIONAL);
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", "devpass"),
			).toBe(DEVPASS_REGIONAL);
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

		it("maps DevPass orgs to the devpass variant", () => {
			expect(
				getOrganizationEnvVariant({
					plan: "free",
					kind: "devpass",
					devPlan: "pro",
				}),
			).toBe("devpass");
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

		it("returns undefined for regular orgs, inactive dev plans, and missing orgs", () => {
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
			expect(getOrganizationEnvVariant(null)).toBeUndefined();
			expect(getOrganizationEnvVariant(undefined)).toBeUndefined();
		});
	});
});
