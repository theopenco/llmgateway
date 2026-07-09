import { describe, expect, it } from "vitest";

import { normalizeSsoDomains } from "./sso-domains.js";

describe("normalizeSsoDomains", () => {
	it("accepts a single domain", () => {
		expect(normalizeSsoDomains("acme.com")).toEqual({
			domains: ["acme.com"],
			invalid: [],
		});
	});

	it("splits, trims and lowercases comma-separated domains", () => {
		expect(normalizeSsoDomains(" Swone.HU , softwareone.com ")).toEqual({
			domains: ["swone.hu", "softwareone.com"],
			invalid: [],
		});
	});

	it("dedupes repeated domains and skips empty entries", () => {
		expect(normalizeSsoDomains("acme.com,,ACME.com, ,eu.acme.com")).toEqual({
			domains: ["acme.com", "eu.acme.com"],
			invalid: [],
		});
	});

	it("accepts subdomains and hyphenated labels", () => {
		expect(normalizeSsoDomains("dept.acme-corp.co.uk")).toEqual({
			domains: ["dept.acme-corp.co.uk"],
			invalid: [],
		});
	});

	it("rejects entries that are not valid domains", () => {
		expect(
			normalizeSsoDomains("acme.com, not a domain, jane@acme.com"),
		).toEqual({
			domains: ["acme.com"],
			invalid: ["not a domain", "jane@acme.com"],
		});
	});

	it("rejects bare TLD-less names, schemes and leading/trailing hyphens", () => {
		expect(normalizeSsoDomains("localhost")).toEqual({
			domains: [],
			invalid: ["localhost"],
		});
		expect(normalizeSsoDomains("https://acme.com")).toEqual({
			domains: [],
			invalid: ["https://acme.com"],
		});
		expect(normalizeSsoDomains("-acme.com,acme-.com")).toEqual({
			domains: [],
			invalid: ["-acme.com", "acme-.com"],
		});
	});

	it("returns nothing for an empty or whitespace-only input", () => {
		expect(normalizeSsoDomains("")).toEqual({ domains: [], invalid: [] });
		expect(normalizeSsoDomains(" , ")).toEqual({ domains: [], invalid: [] });
	});
});
