import { describe, expect, it } from "vitest";

import {
	CONSUMER_EMAIL_DOMAINS,
	extractEmailDomain,
	isConfigurableDomain,
	normalizeDomain,
} from "./sso-domain.js";

describe("normalizeDomain", () => {
	it("lowercases, trims, and strips a leading @", () => {
		expect(normalizeDomain("  @Acme.COM ")).toBe("acme.com");
		expect(normalizeDomain("Example.io")).toBe("example.io");
		expect(normalizeDomain("acme.com")).toBe("acme.com");
	});
});

describe("extractEmailDomain", () => {
	it("returns the lowercased domain after the last @", () => {
		expect(extractEmailDomain("Jane.Doe@Acme.com")).toBe("acme.com");
		expect(extractEmailDomain("weird@sub@corp.example.com")).toBe(
			"corp.example.com",
		);
	});

	it("returns null for malformed addresses", () => {
		expect(extractEmailDomain("no-at-sign")).toBeNull();
		expect(extractEmailDomain("@leading.com")).toBeNull();
		expect(extractEmailDomain("trailing@")).toBeNull();
		expect(extractEmailDomain("")).toBeNull();
	});
});

describe("isConfigurableDomain", () => {
	it("accepts well-formed corporate domains", () => {
		expect(isConfigurableDomain("acme.com")).toBe(true);
		expect(isConfigurableDomain("mail.corp.example.io")).toBe(true);
	});

	it("rejects consumer email providers", () => {
		for (const consumer of CONSUMER_EMAIL_DOMAINS) {
			expect(isConfigurableDomain(consumer)).toBe(false);
		}
	});

	it("rejects malformed domains", () => {
		expect(isConfigurableDomain("acme")).toBe(false);
		expect(isConfigurableDomain("acme.")).toBe(false);
		expect(isConfigurableDomain("@acme.com")).toBe(false);
		expect(isConfigurableDomain("")).toBe(false);
	});
});
