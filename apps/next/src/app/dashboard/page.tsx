import { redirect } from "next/navigation";

import { fetchServerData } from "@/lib/server-api";

import type { User } from "@/lib/types";

// Force dynamic rendering since this page uses cookies for authentication
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	console.log("DashboardPage: Starting redirect logic");

	// Fetch user data server-side
	const initialUserData = await fetchServerData<
		{ user: User } | undefined | null
	>("GET", "/user/me");

	console.log("DashboardPage: User data:", initialUserData);

	// Redirect to login if not authenticated
	if (!initialUserData?.user) {
		console.log("DashboardPage: Redirecting to login - no user");
		redirect("/login");
	}

	// Fetch organizations server-side
	const initialOrganizationsData = await fetchServerData("GET", "/orgs");

	console.log("DashboardPage: Organizations data:", initialOrganizationsData);

	// Check if organizations data is null (API error)
	if (!initialOrganizationsData) {
		console.log(
			"DashboardPage: Organizations API returned null - possible API error",
		);
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

		console.log(
			"DashboardPage: Organizations found:",
			data.organizations?.length,
		);

		if (data.organizations && data.organizations.length > 0) {
			const defaultOrgId = data.organizations[0].id;
			console.log("DashboardPage: Using default org:", defaultOrgId);

			// Fetch projects for the default organization
			const projectsData = await fetchServerData("GET", "/orgs/{id}/projects", {
				params: {
					path: {
						id: defaultOrgId,
					},
				},
			});

			console.log("DashboardPage: Projects data:", projectsData);

			// Check if projects data is null (API error)
			if (!projectsData) {
				console.log(
					"DashboardPage: Projects API returned null - redirecting to org level",
				);
				redirect(`/dashboard/${defaultOrgId}`);
			}

			if (projectsData && typeof projectsData === "object") {
				const projects = projectsData as {
					projects?: Array<{ id: string; name: string }>;
				};

				console.log(
					"DashboardPage: Projects found:",
					projects.projects?.length,
				);

				if (projects.projects && projects.projects.length > 0) {
					const defaultProjectId = projects.projects[0].id;
					console.log(
						"DashboardPage: Redirecting to:",
						`/dashboard/${defaultOrgId}/${defaultProjectId}`,
					);
					// Redirect to the proper route structure
					redirect(`/dashboard/${defaultOrgId}/${defaultProjectId}`);
				}
			}

			// If no projects found, redirect to organization level
			console.log(
				"DashboardPage: No projects found, redirecting to org level:",
				`/dashboard/${defaultOrgId}`,
			);
			redirect(`/dashboard/${defaultOrgId}`);
		}
	}

	// If no organizations found, redirect to onboarding
	console.log(
		"DashboardPage: No organizations found, redirecting to onboarding",
	);
	redirect("/onboarding");
}
