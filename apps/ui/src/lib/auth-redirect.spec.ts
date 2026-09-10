import { describe, expect, test } from "vitest";

import { getAuthRedirect, isCliAuthRedirect } from "./auth-redirect";

describe("authentication redirects", () => {
	test("preserves the CLI verification code through login and SSO", () => {
		const target = "/connect/device?user_code=ABCDEFGH";
		expect(getAuthRedirect(target)).toBe(target);
		expect(isCliAuthRedirect(target)).toBe(true);
		expect(isCliAuthRedirect("/connect/cli?source=codex")).toBe(true);
	});

	test.each([
		undefined,
		"https://outside.example.com",
		"//outside.example.com",
		"/\\outside.example.com",
		"\\outside.example.com",
		"/\n/outside.example.com",
	])("rejects external or malformed redirects: %s", (target) => {
		expect(getAuthRedirect(target)).toBe("/dashboard");
	});

	test("keeps normal dashboard onboarding and does not accept lookalike approval paths", () => {
		expect(getAuthRedirect("/dashboard?tab=keys#new")).toBe(
			"/dashboard?tab=keys#new",
		);
		expect(isCliAuthRedirect("/dashboard")).toBe(false);
		expect(isCliAuthRedirect("/connect/device-attacker")).toBe(false);
	});
});
