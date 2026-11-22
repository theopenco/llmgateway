import {
	ORGANIZATION_NAVIGATION,
	ORGANIZATION_SETTINGS,
	PROJECT_NAVIGATION,
	PROJECT_SETTINGS,
	USER_NAVIGATION,
} from "@/components/dashboard/dashboard-sidebar";

import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import type { Organization } from "@/lib/types";

export interface AssistantPage {
	/** Stable id the model passes back; the sidebar href, or "dashboard". */
	id: string;
	label: string;
	section: string;
	href: string;
	scope: "project" | "organization";
	/** What the assistant can do once this page is open. */
	offers?: string;
}

// Pages that register their own tools while open; keep in step with them.
const PAGE_OFFERS: Record<string, string> = {
	"api-keys": "create or list this project's API keys",
};

function toPages(
	items: readonly { href: string; label: string }[],
	section: string,
): AssistantPage[] {
	return items.map((item) => ({
		id: item.href || "dashboard",
		label: item.label,
		section,
		href: item.href,
		scope: item.href.startsWith("org/") ? "organization" : "project",
		offers: PAGE_OFFERS[item.href],
	}));
}

const ACCOUNT_PAGES = [
	{ href: "settings/account", label: "Account" },
	{ href: "settings/security", label: "Security" },
] as const;

// Organization pages OrganizationRouteGuard lets every member open.
const SHARED_ORGANIZATION_PAGES = ["org/models", "org/skills"];

/**
 * The dashboard pages this member can actually open, for the assistant. It
 * follows the sidebar and OrganizationRouteGuard, so the assistant never
 * sends anyone to a page that answers "unauthorized".
 */
export function getAssistantPages(role: Organization["role"]): AssistantPage[] {
	if (role === "developer") {
		return [
			...toPages(USER_NAVIGATION, "My usage"),
			...toPages(ACCOUNT_PAGES, "Account"),
		];
	}
	const admin = isOrganizationAdmin(role);
	return [
		...toPages(PROJECT_NAVIGATION, "Project"),
		...toPages(PROJECT_SETTINGS, "Project settings"),
		...toPages(
			ORGANIZATION_NAVIGATION.filter(
				(item) => admin || SHARED_ORGANIZATION_PAGES.includes(item.href),
			),
			"Organization",
		),
		...(admin ? toPages(ORGANIZATION_SETTINGS, "Organization settings") : []),
		...toPages(ACCOUNT_PAGES, "Account"),
	];
}
