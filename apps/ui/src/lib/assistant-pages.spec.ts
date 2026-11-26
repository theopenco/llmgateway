import { describe, expect, it, vi } from "vitest";

import { getAssistantPages } from "./assistant-pages";

// The sidebar module pulls in the whole dashboard; only its link lists matter.
vi.mock("@/components/dashboard/dashboard-sidebar", () => ({
	PROJECT_NAVIGATION: [
		{ href: "", label: "Dashboard" },
		{ href: "api-keys", label: "API Keys" },
	],
	USER_NAVIGATION: [{ href: "me", label: "Dashboard" }],
	PROJECT_SETTINGS: [{ href: "settings/preferences", label: "Preferences" }],
	ORGANIZATION_NAVIGATION: [
		{ href: "org/projects", label: "Projects" },
		{ href: "org/models", label: "Models" },
		{ href: "org/skills", label: "Skills" },
	],
	ORGANIZATION_SETTINGS: [
		{ href: "org/billing", label: "Billing" },
		{ href: "org/notifications", label: "Notifications" },
	],
}));

const ids = (role: Parameters<typeof getAssistantPages>[0]) =>
	getAssistantPages(role).map((page) => page.id);

describe("getAssistantPages", () => {
	it.each(["owner", "admin"] as const)("offers every page to an %s", (role) => {
		expect(ids(role)).toEqual(
			expect.arrayContaining(["api-keys", "org/projects", "org/billing"]),
		);
	});

	it("keeps a project admin off pages the route guard refuses", () => {
		const pages = ids("project_admin");
		expect(pages).toEqual(
			expect.arrayContaining(["dashboard", "api-keys", "org/models"]),
		);
		expect(pages).toContain("org/skills");
		expect(pages).not.toContain("org/projects");
		expect(pages).not.toContain("org/billing");
		expect(pages).not.toContain("org/notifications");
	});

	it("limits a developer to their own pages", () => {
		expect(ids("developer")).toEqual([
			"me",
			"settings/account",
			"settings/security",
		]);
	});

	it("says which page adds tools", () => {
		expect(
			getAssistantPages("owner").find((page) => page.id === "api-keys")?.offers,
		).toContain("API keys");
	});
});
