"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";

/**
 * Keeps project-scoped "developer" members inside their personal `/me` area.
 * Any other project page redirects to the developer dashboard, so a developer
 * can only ever reach their own usage and their own API keys.
 */
export function DeveloperRouteGuard() {
	const pathname = usePathname();
	const router = useRouter();
	const { selectedOrganization, buildUrl } = useDashboardNavigation();
	const role = selectedOrganization?.role;

	useEffect(() => {
		if (role !== "developer") {
			return;
		}
		const match = pathname.match(/^\/dashboard\/[^/]+\/[^/]+(\/.*)?$/);
		if (!match) {
			return;
		}
		const sub = match[1] ?? "";
		if (sub === "/me" || sub.startsWith("/me/")) {
			return;
		}
		router.replace(buildUrl("me"));
	}, [role, pathname, router, buildUrl]);

	return null;
}
