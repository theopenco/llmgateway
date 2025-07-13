"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { useDashboardState } from "@/lib/dashboard-state";
import {
	buildDashboardUrl,
	extractOrgAndProjectFromPath,
} from "@/lib/navigation-utils";

export function useDashboardNavigation() {
	const pathname = usePathname();

	// Extract org and project IDs from current path
	const { orgId, projectId } = useMemo(() => {
		return extractOrgAndProjectFromPath(pathname);
	}, [pathname]);

	// Get the dashboard state with the route parameters
	const { selectedOrganization, selectedProject } = useDashboardState({
		selectedOrgId: orgId || undefined,
		selectedProjectId: projectId || undefined,
	});

	// Use the selected organization and project from state, fallback to path params
	const currentOrgId = selectedOrganization?.id || orgId;
	const currentProjectId = selectedProject?.id || projectId;

	// Helper function to build dashboard URLs
	const buildUrl = (subPath?: string) => {
		return buildDashboardUrl(currentOrgId, currentProjectId, subPath);
	};

	return {
		orgId: currentOrgId,
		projectId: currentProjectId,
		buildUrl,
		selectedOrganization,
		selectedProject,
	};
}
