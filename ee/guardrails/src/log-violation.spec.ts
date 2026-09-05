import { beforeEach, describe, expect, it, vi } from "vitest";

import { logViolation } from "./engine.js";

const insertValues = vi.fn().mockResolvedValue(undefined);

vi.mock(import("@llmgateway/db"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		db: {
			insert: () => ({ values: insertValues }),
		} as unknown as typeof actual.db,
	};
});

const violation = {
	ruleId: "system:pii_detection",
	ruleName: "PII detection",
	category: "pii",
	action: "block" as const,
	matchedPattern: "sensitive@example.com",
	matchedContent: "Contact sensitive@example.com",
};

describe("logViolation", () => {
	beforeEach(() => {
		insertValues.mockClear();
	});

	it("retains matched content by default", async () => {
		await logViolation("org-id", violation);

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				matchedPattern: violation.matchedPattern,
				matchedContent: violation.matchedContent,
			}),
		);
	});

	it("omits matched content when retention is disabled", async () => {
		await logViolation("org-id", violation, {
			retainSensitiveContent: false,
		});

		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				matchedPattern: undefined,
				matchedContent: undefined,
			}),
		);
	});
});
