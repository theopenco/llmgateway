import { describe, expect, it } from "vitest";

import {
	chatPlanCreditErrorMessage,
	isInsufficientCreditsError,
} from "./credit-error";

describe("isInsufficientCreditsError", () => {
	it("treats any 402 as an insufficient-credits error", () => {
		expect(isInsufficientCreditsError(402, "anything")).toBe(true);
		expect(isInsufficientCreditsError(402, undefined)).toBe(true);
	});

	it("matches the gateway's video credit message on a non-402 status", () => {
		expect(
			isInsufficientCreditsError(
				400,
				"Video generation requires at least $1.00 in available credits. Please add credits and try again.",
			),
		).toBe(true);
	});

	it("matches common insufficient-credit phrasings", () => {
		expect(isInsufficientCreditsError(403, "Insufficient credits")).toBe(true);
		expect(isInsufficientCreditsError(400, "You are out of credits")).toBe(
			true,
		);
	});

	it("does not match unrelated errors", () => {
		expect(
			isInsufficientCreditsError(
				400,
				"Image size not allowed on the free plan",
			),
		).toBe(false);
		expect(isInsufficientCreditsError(500, "Internal Server Error")).toBe(
			false,
		);
		expect(isInsufficientCreditsError(undefined, undefined)).toBe(false);
	});
});

describe("chatPlanCreditErrorMessage", () => {
	it("upsells a subscription when not subscribed", () => {
		expect(chatPlanCreditErrorMessage(false, "videos")).toBe(
			"Subscribe to a plan to continue generating videos.",
		);
	});

	it("prompts a plan upgrade when subscribed but out of plan credits", () => {
		expect(chatPlanCreditErrorMessage(true, "images")).toBe(
			"You've used all your plan credits. Upgrade your plan to continue generating images.",
		);
	});
});
