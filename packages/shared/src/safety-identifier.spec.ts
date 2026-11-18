import { afterEach, describe, expect, test, vi } from "vitest";

import {
	getOrganizationSafetyIdentifier,
	isOrganizationSafetyIdentifier,
	organizationMatchesSafetyIdentifier,
} from "./safety-identifier.js";

afterEach(() => vi.unstubAllEnvs());

describe("getOrganizationSafetyIdentifier", () => {
	test("is deterministic per organization and differs across organizations", () => {
		const a = getOrganizationSafetyIdentifier("org-a");
		expect(getOrganizationSafetyIdentifier("org-a")).toBe(a);
		expect(getOrganizationSafetyIdentifier("org-b")).not.toBe(a);
		expect(isOrganizationSafetyIdentifier(a)).toBe(true);
		expect(a.length).toBeLessThanOrEqual(128);
		expect(a).not.toContain("org-a");
	});

	test("depends on the gateway secret", () => {
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "secret-one");
		const first = getOrganizationSafetyIdentifier("org-a");
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "secret-two");
		expect(getOrganizationSafetyIdentifier("org-a")).not.toBe(first);
	});

	test("resolves identifiers issued under any keyring secret", () => {
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "secret-old");
		const old = getOrganizationSafetyIdentifier("org-a");
		vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "secret-new,secret-old");
		expect(organizationMatchesSafetyIdentifier("org-a", old)).toBe(true);
		expect(
			organizationMatchesSafetyIdentifier(
				"org-a",
				getOrganizationSafetyIdentifier("org-a"),
			),
		).toBe(true);
		expect(organizationMatchesSafetyIdentifier("org-b", old)).toBe(false);
	});

	test("recognizes only the identifier format", () => {
		expect(isOrganizationSafetyIdentifier("org_abc")).toBe(false);
		expect(isOrganizationSafetyIdentifier(`key_${"a".repeat(32)}`)).toBe(false);
	});
});
