import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reportKeyError, resetKeyHealth } from "@/lib/api-key-health.js";
import { resetRoundRobinCounters } from "@/lib/round-robin-env.js";

import {
	getEnvKeyCount,
	getProviderEnv,
	getServiceTierIneligibleEnvIndices,
	hasServiceTierEligibleEnvCredential,
} from "./get-provider-env.js";

describe("getProviderEnv", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;

	beforeEach(() => {
		resetRoundRobinCounters();
		resetKeyHealth();
		process.env.LLM_OPENAI_API_KEY = "sk-openai-a,sk-openai-b,sk-openai-c";
	});

	afterEach(() => {
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
			return;
		}

		process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
	});

	it("supports non-mutating lookups for auxiliary requests", () => {
		const completionSelection = getProviderEnv("openai");
		expect(completionSelection.token).toBe("sk-openai-a");
		expect(completionSelection.configIndex).toBe(0);

		const moderationSelection = getProviderEnv("openai", {
			advanceRoundRobin: false,
		});
		expect(moderationSelection.token).toBe("sk-openai-a");
		expect(moderationSelection.configIndex).toBe(0);

		const nextCompletionSelection = getProviderEnv("openai");
		expect(nextCompletionSelection.token).toBe("sk-openai-a");
		expect(nextCompletionSelection.configIndex).toBe(0);
	});

	it("defaults to the primary key while it is healthy", () => {
		expect(getProviderEnv("openai").configIndex).toBe(0);
		expect(getProviderEnv("openai").configIndex).toBe(0);
	});

	it("can exclude failed keys when retrying the same provider", () => {
		const secondKey = getProviderEnv("openai", {
			excludedIndices: new Set([0]),
		});
		expect(secondKey.token).toBe("sk-openai-b");
		expect(secondKey.configIndex).toBe(1);

		const thirdKey = getProviderEnv("openai", {
			excludedIndices: new Set([0, 1]),
		});
		expect(thirdKey.token).toBe("sk-openai-c");
		expect(thirdKey.configIndex).toBe(2);
	});

	it("passes selection scope through to env key health", () => {
		reportKeyError("LLM_OPENAI_API_KEY", 0, 500, undefined, "gpt-4");
		reportKeyError("LLM_OPENAI_API_KEY", 0, 500, undefined, "gpt-4");
		reportKeyError("LLM_OPENAI_API_KEY", 0, 500, undefined, "gpt-4");

		const gpt4Selection = getProviderEnv("openai", {
			selectionScope: "gpt-4",
		});
		const claudeSelection = getProviderEnv("openai", {
			selectionScope: "claude-3-5-sonnet",
		});

		expect(gpt4Selection.configIndex).toBe(1);
		expect(claudeSelection.configIndex).toBe(0);
	});
});

describe("getEnvKeyCount", () => {
	const envVar = "LLM_TEST_ENV_KEY_COUNT";

	afterEach(() => {
		delete process.env.LLM_TEST_ENV_KEY_COUNT;
	});

	it("returns 0 when the env var name is undefined", () => {
		expect(getEnvKeyCount(undefined)).toBe(0);
	});

	it("returns 0 when the env var is unset or empty", () => {
		delete process.env.LLM_TEST_ENV_KEY_COUNT;
		expect(getEnvKeyCount(envVar)).toBe(0);
		process.env.LLM_TEST_ENV_KEY_COUNT = "";
		expect(getEnvKeyCount(envVar)).toBe(0);
	});

	it("counts a single key", () => {
		process.env.LLM_TEST_ENV_KEY_COUNT = "sk-only";
		expect(getEnvKeyCount(envVar)).toBe(1);
	});

	it("counts comma-separated keys", () => {
		process.env.LLM_TEST_ENV_KEY_COUNT = "sk-a,sk-b,sk-c";
		expect(getEnvKeyCount(envVar)).toBe(3);
	});

	it("ignores whitespace and empty segments from trailing commas", () => {
		process.env.LLM_TEST_ENV_KEY_COUNT = " sk-a , sk-b ,";
		expect(getEnvKeyCount(envVar)).toBe(2);
		process.env.LLM_TEST_ENV_KEY_COUNT = ",,";
		expect(getEnvKeyCount(envVar)).toBe(0);
	});
});

describe("service-tier env credential eligibility", () => {
	const originalKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
	const originalBaseUrl = process.env.LLM_GOOGLE_VERTEX_BASE_URL;
	const originalRegion = process.env.LLM_GOOGLE_VERTEX_REGION;

	afterEach(() => {
		if (originalKey === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
		} else {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = originalKey;
		}
		if (originalBaseUrl === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		} else {
			process.env.LLM_GOOGLE_VERTEX_BASE_URL = originalBaseUrl;
		}
		if (originalRegion === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_REGION;
		} else {
			process.env.LLM_GOOGLE_VERTEX_REGION = originalRegion;
		}
	});

	it("flags only the env indices whose base URL is a custom proxy", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://vertex-proxy.invalid,https://aiplatform.googleapis.com";

		const ineligible = getServiceTierIneligibleEnvIndices("google-vertex");
		expect([...ineligible]).toEqual([0]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(true);
	});

	it("treats an unset base URL as the eligible managed default", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a";
		delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual(
			[],
		);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(true);
	});

	it("reports no eligible credential when every index is a custom proxy", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://proxy-one.invalid,https://proxy-two.invalid";

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual([
			0, 1,
		]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(false);
	});

	it("flags a non-global Vertex region index as ineligible", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		delete process.env.LLM_GOOGLE_VERTEX_BASE_URL;
		process.env.LLM_GOOGLE_VERTEX_REGION = "global,us-central1";

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual([
			1,
		]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(true);
	});

	it("rejects when the only base-URL-compliant index is a non-global region", () => {
		// index 0: proxy base URL (global region); index 1: canonical upstream but
		// us-central1 — neither can carry the tier, so the provider is ineligible.
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "tok-a,tok-b";
		process.env.LLM_GOOGLE_VERTEX_BASE_URL =
			"https://vertex-proxy.invalid,https://aiplatform.googleapis.com";
		process.env.LLM_GOOGLE_VERTEX_REGION = "global,us-central1";

		expect([...getServiceTierIneligibleEnvIndices("google-vertex")]).toEqual([
			0, 1,
		]);
		expect(hasServiceTierEligibleEnvCredential("google-vertex")).toBe(false);
	});
});
