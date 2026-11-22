import {
	ORGANIZATION_NAVIGATION,
	ORGANIZATION_SETTINGS,
	PROJECT_NAVIGATION,
	PROJECT_SETTINGS,
	USER_NAVIGATION,
} from "@/components/dashboard/dashboard-sidebar";

import type { Organization } from "@/lib/types";

export interface AssistantPage {
	/** Stable id the model passes back; the sidebar href, or "dashboard". */
	id: string;
	label: string;
	section: string;
	href: string;
	scope: "project" | "organization";
}

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
	}));
}

const ACCOUNT_PAGES = [
	{ href: "settings/account", label: "Account" },
	{ href: "settings/security", label: "Security" },
] as const;

/** Every dashboard page the sidebar offers this member, for the assistant. */
export function getAssistantPages(role: Organization["role"]): AssistantPage[] {
	if (role === "developer") {
		return [
			...toPages(USER_NAVIGATION, "My usage"),
			...toPages(ACCOUNT_PAGES, "Account"),
		];
	}
	return [
		...toPages(PROJECT_NAVIGATION, "Project"),
		...toPages(PROJECT_SETTINGS, "Project settings"),
		...toPages(ORGANIZATION_NAVIGATION, "Organization"),
		...toPages(ORGANIZATION_SETTINGS, "Organization settings"),
		...toPages(ACCOUNT_PAGES, "Account"),
	];
}
