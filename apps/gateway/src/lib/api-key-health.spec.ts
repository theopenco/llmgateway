import { describe, it, expect, beforeEach } from "vitest";

import {
	isKeyHealthy,
	reportKeySuccess,
	reportKeyError,
	getKeyHealth,
	resetKeyHealth,
} from "./api-key-health.js";

describe("api-key-health", () => {
	beforeEach(() => {
		resetKeyHealth();
	});

	describe("isKeyHealthy", () => {
		it("should return true for keys with no health data", () => {
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(true);
		});

		it("should return true after successful requests", () => {
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(true);
		});

		it("should return true after fewer than threshold errors", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(true);
		});

		it("should return false after reaching error threshold", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(false);
		});

		it("should return false for permanently blacklisted keys (401)", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 401);
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(false);
		});

		it("should return false for permanently blacklisted keys (403)", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 403);
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(false);
		});

		it("should track different keys independently", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);

			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(false);
			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 1)).toBe(true);
			expect(isKeyHealthy("LLM_ANTHROPIC_API_KEY", 0)).toBe(true);
		});
	});

	describe("reportKeySuccess", () => {
		it("should reset consecutive errors", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);

			reportKeySuccess("LLM_OPENAI_API_KEY", 0);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.consecutiveErrors).toBe(0);
		});

		it("should not reset permanently blacklisted keys", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 401);
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);

			expect(isKeyHealthy("LLM_OPENAI_API_KEY", 0)).toBe(false);
		});
	});

	describe("reportKeyError", () => {
		it("should increment consecutive errors", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.consecutiveErrors).toBe(1);
		});

		it("should update last error time", () => {
			const before = Date.now();
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			const after = Date.now();

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.lastErrorTime).toBeGreaterThanOrEqual(before);
			expect(health?.lastErrorTime).toBeLessThanOrEqual(after);
		});

		it("should permanently blacklist on 401", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 401);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.permanentlyBlacklisted).toBe(true);
		});

		it("should permanently blacklist on 403", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 403);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.permanentlyBlacklisted).toBe(true);
		});

		it("should not permanently blacklist on other errors", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 429);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 502);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.permanentlyBlacklisted).toBe(false);
		});
	});

	describe("getKeyHealth", () => {
		it("should return undefined for unknown keys", () => {
			expect(getKeyHealth("LLM_UNKNOWN", 0)).toBeUndefined();
		});

		it("should return health data for known keys", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health).toBeDefined();
			expect(health?.consecutiveErrors).toBe(1);
		});
	});

	describe("resetKeyHealth", () => {
		it("should clear all health data", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_ANTHROPIC_API_KEY", 1, 401);

			resetKeyHealth();

			expect(getKeyHealth("LLM_OPENAI_API_KEY", 0)).toBeUndefined();
			expect(getKeyHealth("LLM_ANTHROPIC_API_KEY", 1)).toBeUndefined();
		});
	});
});
