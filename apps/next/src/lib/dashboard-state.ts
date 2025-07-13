"use client";

import { useRouter } from "next/navigation";
import { useMemo, useCallback } from "react";

import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

import type { Organization, Project } from "@/lib/types";

interface UseDashboardStateProps {
	initialOrganizationsData?: unknown;
	initialProjectsData?: unknown;
	selectedOrgId?: string;
	selectedProjectId?: string;
}

export function useDashboardState({
	initialOrganizationsData,
	initialProjectsData,
	selectedOrgId,
	selectedProjectId,
}: UseDashboardStateProps = {}) {
	const router = useRouter();
	const api = useApi();

	useUser({ redirectTo: "/login", redirectWhen: "unauthenticated" });

	// Fetch organizations
	const { data: organizationsData } = api.useQuery(
		"get",
		"/orgs",
		{},
		{
			initialData: initialOrganizationsData as
				| { organizations: Organization[] }
				| undefined,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);
	const organizations = useMemo(
		() => organizationsData?.organizations || [],
		[organizationsData?.organizations],
	);

	// Derive selected organization from props or default to first
	const selectedOrganization = useMemo(() => {
		if (selectedOrgId) {
			return organizations.find((org) => org.id === selectedOrgId) || null;
		}
		return organizations[0] || null;
	}, [selectedOrgId, organizations]);

	// Fetch projects for selected organization
	const { data: projectsData } = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: {
					id: selectedOrganization?.id || "",
				},
			},
		},
		{
			enabled: !!selectedOrganization?.id,
			initialData: initialProjectsData as { projects: Project[] } | undefined,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	// Get current projects from query data
	const projects = useMemo(
		() => projectsData?.projects || [],
		[projectsData?.projects],
	);

	// Derive selected project from props
	const selectedProject = useMemo(() => {
		if (selectedProjectId && projects.length > 0) {
			return (
				projects.find((project) => project.id === selectedProjectId) || null
			);
		}
		return projects[0] || null;
	}, [selectedProjectId, projects]);

	// Navigation functions for the new route structure
	const handleOrganizationCreated = useCallback(
		(org: Organization) => {
			// Navigate to the new organization with first project
			router.push(`/dashboard/${org.id}`);
		},
		[router],
	);

	const handleProjectCreated = useCallback(
		(project: Project) => {
			// Navigate to the new project
			router.push(`/dashboard/${project.organizationId}/${project.id}`);
		},
		[router],
	);

	const handleOrganizationSelect = useCallback(
		(org: Organization | null) => {
			if (org?.id) {
				// Navigate to the new organization
				router.push(`/dashboard/${org.id}`);
			}
		},
		[router],
	);

	const handleProjectSelect = useCallback(
		(project: Project | null) => {
			if (project?.id) {
				// Navigate to the new project
				router.push(`/dashboard/${project.organizationId}/${project.id}`);
			}
		},
		[router],
	);

	return {
		selectedOrganization,
		selectedProject,
		organizations,
		projects,
		handleOrganizationSelect,
		handleProjectSelect,
		handleOrganizationCreated,
		handleProjectCreated,
	};
}
