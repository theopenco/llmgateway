import { describe, expect, it } from "vitest";

import { buildOrganizationTabUrl } from "./organization-tab-url";

describe("buildOrganizationTabUrl", () => {
	it("selects a tab while preserving other query parameters", () => {
		expect(
			buildOrganizationTabUrl(
				"/organizations/org-id",
				new URLSearchParams("txPage=2"),
				"settings",
			),
		).toBe("/organizations/org-id?txPage=2&tab=settings");
	});

	it("replaces a selected tab", () => {
		expect(
			buildOrganizationTabUrl(
				"/organizations/org-id",
				new URLSearchParams("tab=settings&txPage=2"),
				"guardrails",
			),
		).toBe("/organizations/org-id?tab=guardrails&txPage=2");
	});

	it("removes the default tab without leaving a trailing query", () => {
		expect(
			buildOrganizationTabUrl(
				"/organizations/org-id",
				new URLSearchParams("tab=settings"),
				"transactions",
			),
		).toBe("/organizations/org-id");
	});
});
