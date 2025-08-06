import { redirect } from "next/navigation";

import { fetchServerData } from "@/lib/server-api";

import type { User } from "@/lib/types";

// Force dynamic rendering since this page uses cookies for authentication
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	// Fetch user data server-side
	const initialUserData = await fetchServerData<
		{ user: User } | undefined | null
	>("GET", "/user/me");

	// Redirect to login if not authenticated
	if (!initialUserData?.user) {
		redirect("/login");
	}

	// Fetch organizations server-side
	const initialOrganizationsData = await fetchServerData("GET", "/orgs");

	// Check if organizations data is null (API error)
	if (!initialOrganizationsData) {
		// Show error page or redirect to onboarding
		redirect("/onboarding");
	}

	// Determine default organization and project for redirect
	if (
		initialOrganizationsData &&
		typeof initialOrganizationsData === "object"
	) {
		const data = initialOrganizationsData as {
			organizations?: Array<{ id: string; name: string }>;
		};

		if (data.organizations && data.organizations.length > 0) {
			const defaultOrgId = data.organizations[0].id;

			// Fetch projects for the default organization
			const projectsData = await fetchServerData("GET", "/orgs/{id}/projects", {
				params: {
					path: {
						id: defaultOrgId,
					},
				},
			});

			// Check if projects data is null (API error)
			if (!projectsData) {
				redirect(`/dashboard/${defaultOrgId}`);
			}

			if (projectsData && typeof projectsData === "object") {
				const projects = projectsData as {
					projects?: Array<{ id: string; name: string }>;
				};

				if (projects.projects && projects.projects.length > 0) {
					const defaultProjectId = projects.projects[0].id;
					// Redirect to the proper route structure
					redirect(`/dashboard/${defaultOrgId}/${defaultProjectId}`);
				}
			}

			// If no projects found, redirect to organization level
			redirect(`/dashboard/${defaultOrgId}`);
		}
	}

	// If no organizations found, redirect to onboarding
	redirect("/onboarding");
}
