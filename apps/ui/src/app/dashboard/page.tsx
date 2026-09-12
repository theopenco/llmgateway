import { redirect } from "next/navigation";

import { getLastUsedProjectId } from "@/lib/last-used-project-server";
import { getOrganizations, getOrgProjects, getUserMe } from "@/lib/server-api";

export default async function DashboardPage() {
	// Fetch user and organization data server-side in parallel, through the
	// request-deduped helpers shared with the dashboard layouts.
	const initialUserDataPromise = getUserMe();
	const initialOrganizationsDataPromise = getOrganizations();

	const initialUserData = await initialUserDataPromise;

	// Redirect to login if not authenticated
	if (!initialUserData?.user) {
		redirect("/login");
	}

	const initialOrganizationsData = await initialOrganizationsDataPromise;

	// Check if organizations data is null (API error)
	if (!initialOrganizationsData) {
		// Show error page or redirect to onboarding
		redirect("/onboarding");
	}

	// Determine default organization and project for redirect
	if (
		initialOrganizationsData.organizations &&
		initialOrganizationsData.organizations.length > 0
	) {
		const defaultOrgId = initialOrganizationsData.organizations[0].id;

		// Fetch projects for the default organization
		const projectsData = await getOrgProjects(defaultOrgId);

		// Check if projects data is null (API error)
		if (!projectsData) {
			redirect(`/dashboard/${defaultOrgId}`);
		}

		if (projectsData.projects && projectsData.projects.length > 0) {
			// Check for last used project first, fallback to first project
			const lastUsedProjectId = await getLastUsedProjectId(defaultOrgId);
			const defaultProjectId =
				lastUsedProjectId &&
				projectsData.projects.some((p) => p.id === lastUsedProjectId)
					? lastUsedProjectId
					: projectsData.projects[0].id;

			// Redirect to the proper route structure
			redirect(`/dashboard/${defaultOrgId}/${defaultProjectId}`);
		}

		// If no projects found, redirect to organization level
		redirect(`/dashboard/${defaultOrgId}`);
	}

	// If no organizations found, redirect to onboarding
	redirect("/onboarding");
}
