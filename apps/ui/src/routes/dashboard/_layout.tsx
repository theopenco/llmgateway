import { useQueryClient } from "@tanstack/react-query";
import {
	Outlet,
	createFileRoute,
	useRouterState,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { EmailVerificationBanner } from "@/components/dashboard/email-verification-banner";
import { MobileHeader } from "@/components/dashboard/mobile-header";
import { TopBar } from "@/components/dashboard/top-bar";
import { useUser } from "@/hooks/useUser";
import { SidebarProvider } from "@/lib/components/sidebar";
import { toast } from "@/lib/components/use-toast";
import { DashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

import type { Organization, Project } from "@/lib/types";

export const Route = createFileRoute("/dashboard/_layout")({
	component: RouteComponent,
});

function RouteComponent() {
	const posthog = usePostHog();
	const { location } = useRouterState();
	const navigate = useNavigate();
	const search = useSearch({ from: "/dashboard/_layout" }) as {
		emailVerified?: boolean;
	};
	const queryClient = useQueryClient();
	const [selectedOrganizationId, setSelectedOrganizationId] = useState<
		string | null
	>(null);
	const [selectedProject, setSelectedProject] = useState<Project | null>(null);
	const api = useApi();

	const { user } = useUser({
		redirectTo: "/login",
		redirectWhen: "unauthenticated",
	});

	// Fetch organizations
	const { data: organizationsData } = api.useQuery("get", "/orgs");
	const organizations = useMemo(
		() => organizationsData?.organizations || [],
		[organizationsData?.organizations],
	);

	// Derive selected organization from query data
	const selectedOrganization = useMemo(() => {
		if (selectedOrganizationId) {
			return (
				organizations.find((org) => org.id === selectedOrganizationId) || null
			);
		}
		return organizations[0] || null;
	}, [selectedOrganizationId, organizations]);

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
		},
	);

	// Get current projects from query data
	const projects = useMemo(
		() => projectsData?.projects || [],
		[projectsData?.projects],
	);

	// Auto-select first organization if none selected
	useEffect(() => {
		if (organizations.length > 0 && !selectedOrganizationId) {
			setSelectedOrganizationId(organizations[0].id);
		}
	}, [organizations, selectedOrganizationId]);

	// Reset project selection when organization changes
	useEffect(() => {
		setSelectedProject(null);
		// Debounce or wait for projects to load for new org
	}, [selectedOrganization?.id]); // Use id for more stable comparison

	// Auto-select with better condition checking
	useEffect(() => {
		if (projects.length > 0 && !selectedProject && selectedOrganization) {
			// Only auto-select if we have projects for the current org
			// and ensure the projects actually belong to the selected organization
			const firstProject = projects[0];
			if (
				firstProject &&
				firstProject.organizationId === selectedOrganization.id
			) {
				setSelectedProject(firstProject);
			}
		}
	}, [projects, selectedProject, selectedOrganization]);

	useEffect(() => {
		posthog.capture("page_viewed_dashboard");
	}, [posthog]);

	// Handle email verification success
	useEffect(() => {
		if (search.emailVerified) {
			toast({
				title: "Email verified successfully!",
				description: "Your email address has been verified.",
			});

			// Clean up the URL parameter using TanStack Router
			navigate({
				to: location.pathname,
				replace: true,
			});
		}
	}, [search.emailVerified, location.pathname, navigate]);

	// Refetch organizations query when navigating between dashboard pages
	useEffect(() => {
		const orgsQueryKey = api.queryOptions("get", "/orgs").queryKey;
		queryClient.invalidateQueries({ queryKey: orgsQueryKey });
	}, [location.pathname, api, queryClient]);

	const handleOrganizationCreated = (org: Organization) => {
		setSelectedOrganizationId(org.id);
	};

	const handleProjectCreated = (project: Project) => {
		// The project will be added to the cache by the mutation's onSuccess callback
		// Just select the new project
		setSelectedProject(project);
	};

	const contextValue = useMemo(
		() => ({ selectedOrganization, selectedProject }),
		[selectedOrganization, selectedProject],
	);

	return (
		<DashboardContext.Provider value={contextValue}>
			<SidebarProvider>
				<div className="flex min-h-screen w-full flex-col">
					<MobileHeader />
					<div className="flex flex-1">
						<DashboardSidebar
							organizations={organizations}
							onSelectOrganization={(org) =>
								setSelectedOrganizationId(org?.id || null)
							}
							onOrganizationCreated={handleOrganizationCreated}
						/>
						<div className="flex flex-1 flex-col justify-center">
							<TopBar
								projects={projects}
								selectedProject={selectedProject}
								onSelectProject={setSelectedProject}
								selectedOrganization={selectedOrganization}
								onProjectCreated={handleProjectCreated}
							/>
							{user && !user.emailVerified && (
								<EmailVerificationBanner userEmail={user.email} />
							)}
							<main className="bg-background max-w-7xl mx-auto w-full flex-1 overflow-y-auto pt-10 pb-4 px-4 md:p-6 lg:p-8">
								<Outlet />
							</main>
						</div>
					</div>
				</div>
			</SidebarProvider>
		</DashboardContext.Provider>
	);
}
