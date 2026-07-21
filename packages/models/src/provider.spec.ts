import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getEnterpriseEnvVarName,
	getRegionSpecificEnvVarName,
} from "./provider.js";

const BASE = "LLM_ALIBABA_API_KEY";
const ENTERPRISE = `${BASE}__ENTERPRISE`;
const REGIONAL = `${BASE}__US_VIRGINIA`;
const ENTERPRISE_REGIONAL = `${BASE}__ENTERPRISE__US_VIRGINIA`;

describe("enterprise env var helpers", () => {
	beforeEach(() => {
		for (const name of [BASE, ENTERPRISE, REGIONAL, ENTERPRISE_REGIONAL]) {
			vi.stubEnv(name, undefined);
		}
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe("getEnterpriseEnvVarName", () => {
		it("returns the enterprise var name only when it is set", () => {
			expect(getEnterpriseEnvVarName("alibaba")).toBeUndefined();
			vi.stubEnv(ENTERPRISE, "sk-ent");
			expect(getEnterpriseEnvVarName("alibaba")).toBe(ENTERPRISE);
		});

		it("returns undefined for unknown providers", () => {
			expect(getEnterpriseEnvVarName("not-a-provider")).toBeUndefined();
		});
	});

	describe("getRegionSpecificEnvVarName with enterprise flag", () => {
		it("prefers the enterprise-regional var for enterprise requests", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			vi.stubEnv(ENTERPRISE_REGIONAL, "sk-ent-region");
			expect(getRegionSpecificEnvVarName("alibaba", "us-virginia", true)).toBe(
				ENTERPRISE_REGIONAL,
			);
		});

		it("falls back to the shared regional var when no enterprise-regional var is set", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			expect(getRegionSpecificEnvVarName("alibaba", "us-virginia", true)).toBe(
				REGIONAL,
			);
		});

		it("never returns the enterprise-regional var for non-enterprise requests", () => {
			vi.stubEnv(REGIONAL, "sk-region");
			vi.stubEnv(ENTERPRISE_REGIONAL, "sk-ent-region");
			expect(getRegionSpecificEnvVarName("alibaba", "us-virginia")).toBe(
				REGIONAL,
			);
			expect(getRegionSpecificEnvVarName("alibaba", "us-virginia", false)).toBe(
				REGIONAL,
			);
		});

		it("returns undefined when no regional var is set, even with a plain enterprise var", () => {
			vi.stubEnv(ENTERPRISE, "sk-ent");
			expect(
				getRegionSpecificEnvVarName("alibaba", "us-virginia", true),
			).toBeUndefined();
		});
	});
});
