import { describe, expect, it } from "vitest";

import { buildSecurityTxt } from "./security-txt.js";

describe("buildSecurityTxt", () => {
	it("lists both contacts in order of preference and links the policy", () => {
		const lines = buildSecurityTxt(new Date("2026-01-01T00:00:00Z")).split(
			"\n",
		);
		expect(lines.filter((line) => line.startsWith("Contact: "))).toEqual([
			"Contact: https://github.com/theopenco/llmgateway/security/advisories/new",
			"Contact: mailto:contact@llmgateway.io",
		]);
		expect(lines).toContain(
			"Policy: https://github.com/theopenco/llmgateway/blob/main/SECURITY.md",
		);
	});

	it("expires 180 days after the current UTC day, under the RFC 9116 one-year limit", () => {
		const text = buildSecurityTxt(new Date("2026-03-15T18:42:07Z"));
		expect(text).toContain("Expires: 2026-09-11T00:00:00.000Z");
	});

	it("ends with a newline", () => {
		expect(buildSecurityTxt().endsWith("\n")).toBe(true);
	});
});
