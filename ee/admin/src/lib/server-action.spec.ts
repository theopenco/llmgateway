import { describe, expect, test } from "vitest";

import { runServerAction, serverActionErrorMessage } from "./server-action";

const fallback = "Failed to create credential";

describe("serverActionErrorMessage", () => {
	test("warns that a dropped request may still have saved", () => {
		expect(
			serverActionErrorMessage(
				new TypeError("Failed to fetch"),
				fallback,
				31_000,
			),
		).toBe(
			'Failed to create credential: the admin server did not answer after 31.0 s (browser reported "Failed to fetch"). The change may still have been saved; reload to check before retrying.',
		);
	});

	test("asks for a reload when the action id is gone after a deploy", () => {
		expect(
			serverActionErrorMessage(
				new Error('Server Action "7f3a" was not found on the server.'),
				fallback,
				50,
			),
		).toBe(
			"Failed to create credential: this page is out of date after a deploy. Reload and try again.",
		);
	});

	test("surfaces the digest of a redacted server error", () => {
		const error = Object.assign(new Error("An error occurred"), {
			digest: "1234567",
		});
		expect(serverActionErrorMessage(error, fallback, 2_500)).toContain(
			"(error digest 1234567)",
		);
	});

	test("keeps any other message", () => {
		expect(
			serverActionErrorMessage(
				new Error("An unexpected response was received from the server."),
				fallback,
				60_000,
			),
		).toBe(
			"Failed to create credential after 60.0 s: An unexpected response was received from the server.",
		);
	});
});

describe("runServerAction", () => {
	test("passes a settled result through", async () => {
		await expect(
			runServerAction(async () => ({ success: true }), fallback),
		).resolves.toEqual({ success: true });
	});

	test("turns a rejection into a failed result", async () => {
		const result = await runServerAction(async () => {
			throw new TypeError("Failed to fetch");
		}, fallback);
		expect(result.success).toBe(false);
		expect(result.error).toContain("the admin server did not answer");
	});
});
