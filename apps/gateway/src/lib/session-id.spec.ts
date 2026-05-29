import { describe, expect, it } from "vitest";

import { extractAnthropicSessionId } from "./session-id.js";

describe("extractAnthropicSessionId", () => {
	it("extracts the session segment from a Claude Code user_id", () => {
		expect(
			extractAnthropicSessionId(
				"user_abc123_account_def456_session_9f8e7d6c-1234-4abc-9def-0123456789ab",
			),
		).toBe("session_9f8e7d6c-1234-4abc-9def-0123456789ab");
	});

	it("falls back to the whole value when no session segment is present", () => {
		expect(extractAnthropicSessionId("tenant-42")).toBe("tenant-42");
	});

	it("returns undefined for empty or missing values", () => {
		expect(extractAnthropicSessionId(undefined)).toBeUndefined();
		expect(extractAnthropicSessionId("")).toBeUndefined();
		expect(extractAnthropicSessionId("   ")).toBeUndefined();
	});

	it("trims surrounding whitespace", () => {
		expect(extractAnthropicSessionId("  tenant-42  ")).toBe("tenant-42");
	});
});
