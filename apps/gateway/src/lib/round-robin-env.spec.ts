import { describe, it, expect, beforeEach } from "vitest";

import { reportKeyError, resetKeyHealth } from "./api-key-health.js";
import {
	parseCommaSeparatedEnv,
	getRoundRobinValue,
	getNthValue,
	resetRoundRobinCounters,
} from "./round-robin-env.js";

describe("round-robin-env", () => {
	beforeEach(() => {
		resetRoundRobinCounters();
		resetKeyHealth();
	});

	describe("parseCommaSeparatedEnv", () => {
		it("should parse single value", () => {
			const result = parseCommaSeparatedEnv("value1");
			expect(result).toEqual(["value1"]);
		});

		it("should parse comma-separated values", () => {
			const result = parseCommaSeparatedEnv("value1,value2,value3");
			expect(result).toEqual(["value1", "value2", "value3"]);
		});

		it("should trim whitespace", () => {
			const result = parseCommaSeparatedEnv("value1 , value2 , value3");
			expect(result).toEqual(["value1", "value2", "value3"]);
		});

		it("should filter empty values", () => {
			const result = parseCommaSeparatedEnv("value1,,value2,");
			expect(result).toEqual(["value1", "value2"]);
		});
	});

	describe("getRoundRobinValue", () => {
		it("should return the only value for single value", () => {
			const result1 = getRoundRobinValue("TEST_VAR", "value1");
			expect(result1.value).toBe("value1");
			expect(result1.index).toBe(0);

			const result2 = getRoundRobinValue("TEST_VAR", "value1");
			expect(result2.value).toBe("value1");
			expect(result2.index).toBe(0);
		});

		it("should rotate through multiple values", () => {
			const result1 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result1.value).toBe("value1");
			expect(result1.index).toBe(0);

			const result2 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result2.value).toBe("value2");
			expect(result2.index).toBe(1);

			const result3 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result3.value).toBe("value3");
			expect(result3.index).toBe(2);

			const result4 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result4.value).toBe("value1");
			expect(result4.index).toBe(0);
		});

		it("should maintain separate counters for different env vars", () => {
			const result1 = getRoundRobinValue("VAR_A", "a1,a2");
			expect(result1.value).toBe("a1");

			const result2 = getRoundRobinValue("VAR_B", "b1,b2");
			expect(result2.value).toBe("b1");

			const result3 = getRoundRobinValue("VAR_A", "a1,a2");
			expect(result3.value).toBe("a2");

			const result4 = getRoundRobinValue("VAR_B", "b1,b2");
			expect(result4.value).toBe("b2");
		});

		it("should throw error for empty value", () => {
			expect(() => getRoundRobinValue("TEST_VAR", "")).toThrow(
				"Environment variable TEST_VAR is empty",
			);
		});

		it("should skip unhealthy keys", () => {
			// Mark first key as unhealthy (3 consecutive errors)
			reportKeyError("TEST_VAR", 0, 500);
			reportKeyError("TEST_VAR", 0, 500);
			reportKeyError("TEST_VAR", 0, 500);

			// First call should skip index 0 and return index 1
			const result1 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result1.value).toBe("value2");
			expect(result1.index).toBe(1);

			// Next call should return index 2
			const result2 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result2.value).toBe("value3");
			expect(result2.index).toBe(2);

			// Next call should skip index 0 again and return index 1
			const result3 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result3.value).toBe("value2");
			expect(result3.index).toBe(1);
		});

		it("should fall back to unhealthy keys if all are unhealthy", () => {
			// Mark all keys as unhealthy
			reportKeyError("TEST_VAR", 0, 500);
			reportKeyError("TEST_VAR", 0, 500);
			reportKeyError("TEST_VAR", 0, 500);

			reportKeyError("TEST_VAR", 1, 500);
			reportKeyError("TEST_VAR", 1, 500);
			reportKeyError("TEST_VAR", 1, 500);

			// Should still return values using standard round-robin
			const result1 = getRoundRobinValue("TEST_VAR", "value1,value2");
			expect(result1.value).toBe("value1");

			const result2 = getRoundRobinValue("TEST_VAR", "value1,value2");
			expect(result2.value).toBe("value2");
		});

		it("should skip permanently blacklisted keys (401)", () => {
			// Mark first key as permanently blacklisted
			reportKeyError("TEST_VAR", 0, 401);

			// Should always skip index 0
			const result1 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result1.value).toBe("value2");
			expect(result1.index).toBe(1);

			const result2 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result2.value).toBe("value3");
			expect(result2.index).toBe(2);

			const result3 = getRoundRobinValue("TEST_VAR", "value1,value2,value3");
			expect(result3.value).toBe("value2");
			expect(result3.index).toBe(1);
		});
	});

	describe("getNthValue", () => {
		it("should return nth value", () => {
			expect(getNthValue("value1,value2,value3", 0)).toBe("value1");
			expect(getNthValue("value1,value2,value3", 1)).toBe("value2");
			expect(getNthValue("value1,value2,value3", 2)).toBe("value3");
		});

		it("should return last value if index out of bounds", () => {
			expect(getNthValue("value1,value2", 5)).toBe("value2");
		});

		it("should return default value if provided and empty", () => {
			expect(getNthValue("", 0, "default")).toBe("default");
		});

		it("should throw error if empty and no default", () => {
			expect(() => getNthValue("", 0)).toThrow("Environment variable is empty");
		});

		it("should handle single value", () => {
			expect(getNthValue("value1", 0)).toBe("value1");
			expect(getNthValue("value1", 5)).toBe("value1");
		});
	});
});
