import { describe, it, expect, beforeEach } from "vitest";

import {
	isKeyHealthy,
	reportKeySuccess,
	reportKeyError,
	getKeyHealth,
	getKeyMetrics,
	getAllKeyMetrics,
	calculateUptimePenalty,
	resetKeyHealth,
	UPTIME_PENALTY_THRESHOLD,
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

	describe("getKeyMetrics", () => {
		it("should return 100% uptime for unknown keys", () => {
			const metrics = getKeyMetrics("LLM_UNKNOWN", 0);
			expect(metrics.uptime).toBe(100);
			expect(metrics.totalRequests).toBe(0);
			expect(metrics.consecutiveErrors).toBe(0);
			expect(metrics.permanentlyBlacklisted).toBe(false);
		});

		it("should return 100% uptime for all successful requests", () => {
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);

			const metrics = getKeyMetrics("LLM_OPENAI_API_KEY", 0);
			expect(metrics.uptime).toBe(100);
			expect(metrics.totalRequests).toBe(3);
		});

		it("should calculate uptime based on success/error ratio", () => {
			// 7 successes, 3 errors = 70% uptime
			for (let i = 0; i < 7; i++) {
				reportKeySuccess("LLM_OPENAI_API_KEY", 0);
			}
			for (let i = 0; i < 3; i++) {
				reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			}

			const metrics = getKeyMetrics("LLM_OPENAI_API_KEY", 0);
			expect(metrics.uptime).toBe(70);
			expect(metrics.totalRequests).toBe(10);
		});

		it("should track permanently blacklisted status", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 401);

			const metrics = getKeyMetrics("LLM_OPENAI_API_KEY", 0);
			expect(metrics.permanentlyBlacklisted).toBe(true);
		});

		it("should track consecutive errors", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);

			const metrics = getKeyMetrics("LLM_OPENAI_API_KEY", 0);
			expect(metrics.consecutiveErrors).toBe(2);
		});
	});

	describe("getAllKeyMetrics", () => {
		it("should return metrics for all key indices", () => {
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);
			reportKeyError("LLM_OPENAI_API_KEY", 1, 500);

			const metrics = getAllKeyMetrics("LLM_OPENAI_API_KEY", 3);
			expect(metrics).toHaveLength(3);
			expect(metrics[0].totalRequests).toBe(1);
			expect(metrics[0].uptime).toBe(100);
			expect(metrics[1].totalRequests).toBe(1);
			expect(metrics[1].uptime).toBe(0);
			expect(metrics[2].totalRequests).toBe(0);
			expect(metrics[2].uptime).toBe(100); // No data = 100%
		});
	});

	describe("calculateUptimePenalty", () => {
		it("should return 0 penalty for uptime >= threshold", () => {
			expect(calculateUptimePenalty(100)).toBe(0);
			expect(calculateUptimePenalty(UPTIME_PENALTY_THRESHOLD)).toBe(0);
		});

		it("should return increasing penalty for lower uptime", () => {
			const penalty90 = calculateUptimePenalty(90);
			const penalty80 = calculateUptimePenalty(80);
			const penalty70 = calculateUptimePenalty(70);
			const penalty50 = calculateUptimePenalty(50);

			expect(penalty90).toBeGreaterThan(0);
			expect(penalty80).toBeGreaterThan(penalty90);
			expect(penalty70).toBeGreaterThan(penalty80);
			expect(penalty50).toBeGreaterThan(penalty70);
		});

		it("should have approximately expected penalty values", () => {
			// Based on the formula: ((95 - uptime) / 95 * 5)^2
			expect(calculateUptimePenalty(90)).toBeCloseTo(0.069, 1);
			expect(calculateUptimePenalty(80)).toBeCloseTo(0.62, 1);
			expect(calculateUptimePenalty(70)).toBeCloseTo(1.73, 1);
		});
	});

	describe("history tracking", () => {
		it("should track success in history", () => {
			reportKeySuccess("LLM_OPENAI_API_KEY", 0);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.history).toHaveLength(1);
			expect(health?.history[0].success).toBe(true);
		});

		it("should track errors in history", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 500);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.history).toHaveLength(1);
			expect(health?.history[0].success).toBe(false);
		});

		it("should track permanent blacklist errors in history", () => {
			reportKeyError("LLM_OPENAI_API_KEY", 0, 401);

			const health = getKeyHealth("LLM_OPENAI_API_KEY", 0);
			expect(health?.history).toHaveLength(1);
			expect(health?.history[0].success).toBe(false);
			expect(health?.permanentlyBlacklisted).toBe(true);
		});
	});
});
