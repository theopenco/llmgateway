import { describe, expect, it } from "vitest";

import { resolveSignupMethod } from "./signup-method.js";

describe("resolveSignupMethod", () => {
	it("names the email form", () => {
		expect(resolveSignupMethod("/sign-up/email")).toBe("email");
	});

	it("names the OAuth provider from its callback", () => {
		expect(resolveSignupMethod("/callback/google")).toBe("google");
		expect(resolveSignupMethod("/callback/GitHub")).toBe("github");
		expect(resolveSignupMethod("/oauth2/callback/custom-idp")).toBe(
			"custom-idp",
		);
	});

	it("separates enterprise SSO and SCIM provisioning from self-serve", () => {
		expect(resolveSignupMethod("/sso/saml2/callback/acme")).toBe("sso");
		expect(resolveSignupMethod("/scim/v2/Users")).toBe("scim");
	});

	it("never guesses a provider for other routes", () => {
		expect(resolveSignupMethod("/passkey/verify-registration")).toBe("other");
		expect(resolveSignupMethod(undefined)).toBe("unknown");
	});
});
