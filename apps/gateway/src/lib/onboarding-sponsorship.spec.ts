import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ONBOARDING_SPONSOR_HEADER } from "@llmgateway/shared";

import { isSponsoredOnboardingRequest } from "./onboarding-sponsorship.js";

// This is what stands between "the wizard's first call is free" and "anyone can
// waive their own charges", so the negative cases matter more than the positive
// one.

const SECRET = "correct-horse-battery-staple";

function contextWith(headers: Record<string, string>) {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
		},
	} as unknown as Parameters<typeof isSponsoredOnboardingRequest>[0];
}

describe("isSponsoredOnboardingRequest", () => {
	let previousSecret: string | undefined;

	beforeEach(() => {
		previousSecret = process.env.ONBOARDING_SPONSOR_SECRET;
		process.env.ONBOARDING_SPONSOR_SECRET = SECRET;
	});

	afterEach(() => {
		if (previousSecret === undefined) {
			Reflect.deleteProperty(process.env, "ONBOARDING_SPONSOR_SECRET");
		} else {
			process.env.ONBOARDING_SPONSOR_SECRET = previousSecret;
		}
	});

	test("accepts the configured secret", () => {
		expect(
			isSponsoredOnboardingRequest(
				contextWith({ [ONBOARDING_SPONSOR_HEADER]: SECRET }),
			),
		).toBe(true);
	});

	test("rejects a request with no header", () => {
		expect(isSponsoredOnboardingRequest(contextWith({}))).toBe(false);
	});

	test("rejects a wrong secret", () => {
		expect(
			isSponsoredOnboardingRequest(
				contextWith({ [ONBOARDING_SPONSOR_HEADER]: "guess" }),
			),
		).toBe(false);
	});

	// timingSafeEqual throws on a length mismatch; a prefix must not slip through
	// as an error either.
	test("rejects a prefix of the secret", () => {
		expect(
			isSponsoredOnboardingRequest(
				contextWith({ [ONBOARDING_SPONSOR_HEADER]: SECRET.slice(0, -1) }),
			),
		).toBe(false);
	});

	// Self-hosted and local dev: nothing configured means nothing is given away.
	test("rejects everything when no secret is configured", () => {
		Reflect.deleteProperty(process.env, "ONBOARDING_SPONSOR_SECRET");

		expect(
			isSponsoredOnboardingRequest(
				contextWith({ [ONBOARDING_SPONSOR_HEADER]: SECRET }),
			),
		).toBe(false);
		expect(
			isSponsoredOnboardingRequest(
				contextWith({ [ONBOARDING_SPONSOR_HEADER]: "" }),
			),
		).toBe(false);
	});
});
