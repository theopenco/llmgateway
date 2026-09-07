"use client";

import { usePathname } from "next/navigation";

import { UnauthorizedView } from "@/components/dashboard/unauthorized-view";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";

import type { ReactNode } from "react";

export function ProjectAdminRouteGuard({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const { selectedOrganization, buildOrgUrl } = useDashboardNavigation();
	const isOrgPage = pathname.startsWith(`${buildOrgUrl("org")}/`);
	const isSharedResource = ["org/models", "org/skills"].some(
		(path) =>
			pathname === buildOrgUrl(path) ||
			pathname.startsWith(`${buildOrgUrl(path)}/`),
	);

	if (
		selectedOrganization?.role === "project_admin" &&
		isOrgPage &&
		!isSharedResource
	) {
		return <UnauthorizedView resource="organization" />;
	}

	return children;
}
