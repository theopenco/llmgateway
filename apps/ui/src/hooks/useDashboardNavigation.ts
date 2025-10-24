"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { useDashboardContext } from "@/lib/dashboard-context";
import {
	buildDashboardUrl,
	buildOrgUrl as buildOrganizationUrl,
	extractOrgAndProjectFromPath,
} from "@/lib/navigation-utils";

import type { Route } from "next";

export function useDashboardNavigation() {
	const pathname = usePathname();

	// Get the dashboard state from context (shared across all components)
	const { selectedOrganization, selectedProject } = useDashboardContext();

	// Extract org and project IDs from current path
	const { orgId, projectId } = useMemo(() => {
		return extractOrgAndProjectFromPath(pathname);
	}, [pathname]);

	// Use path params if available, otherwise use context values
	// This ensures navigation works on both project pages and org-only pages
	const currentOrgId = orgId || selectedOrganization?.id;
	const currentProjectId = projectId || selectedProject?.id;

	// Helper function to build dashboard URLs
	const buildUrl = (subPath?: string): Route => {
		return buildDashboardUrl(currentOrgId, currentProjectId, subPath);
	};

	// Helper function to build org-only URLs (without project)
	const buildOrgUrl = (subPath?: string): Route => {
		return buildOrganizationUrl(currentOrgId, subPath) as Route;
	};

	return {
		orgId: currentOrgId,
		projectId: currentProjectId,
		buildUrl,
		buildOrgUrl,
		selectedOrganization,
		selectedProject,
	};
}
