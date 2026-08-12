"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useMyMemberBudget } from "@/hooks/useTeam";

// Sub-paths a project lead may reach on a project they lead, on top of the
// personal `/me` area every developer has. Analytics is the point of the lead
// grant: seeing what the team costs. The project root is deliberately excluded —
// its server component redirects developers before this guard ever runs.
const LEAD_ALLOWED_SUBPATHS = ["/analytics"];

/**
 * Keeps project-scoped "developer" members inside their personal `/me` area.
 * Any other project page redirects to the developer dashboard, so a developer
 * can only ever reach their own usage and their own API keys.
 *
 * A developer holding a `lead` grant on the project in the URL is additionally
 * allowed onto that project's analytics — the team-lead cost view.
 */
export function DeveloperRouteGuard() {
	const pathname = usePathname();
	const router = useRouter();
	const { selectedOrganization, buildUrl, orgId } = useDashboardNavigation();
	const role = selectedOrganization?.role;
	const isDeveloper = role === "developer";

	// Only developers can be leads; owners/admins already reach everything.
	const { data: myMembership, isLoading } = useMyMemberBudget(
		isDeveloper ? (orgId ?? "") : "",
	);

	useEffect(() => {
		if (!isDeveloper) {
			return;
		}
		const match = pathname.match(/^\/dashboard\/[^/]+\/([^/]+)(\/.*)?$/);
		if (!match) {
			return;
		}
		const projectId = match[1];
		const sub = match[2] ?? "";
		if (sub === "/me" || sub.startsWith("/me/")) {
			return;
		}
		// Wait for the lead grants before redirecting, otherwise a lead landing
		// directly on their project's analytics is bounced to /me on first paint.
		if (isLoading) {
			return;
		}
		const leads = myMembership?.leadProjectIds?.includes(projectId) ?? false;
		if (leads && LEAD_ALLOWED_SUBPATHS.includes(sub)) {
			return;
		}
		router.replace(buildUrl("me"));
	}, [isDeveloper, isLoading, myMembership, pathname, router, buildUrl]);

	return null;
}
