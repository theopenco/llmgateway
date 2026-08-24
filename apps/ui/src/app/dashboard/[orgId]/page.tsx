import { redirect } from "next/navigation";

import { getLastUsedProjectId } from "@/lib/last-used-project-server";
import { getOrgProjects } from "@/lib/server-api";

interface OrgPageProps {
	params: Promise<{ orgId: string }>;
}

export default async function OrgPage({ params }: OrgPageProps) {
	const { orgId } = await params;

	// Fetch projects for this organization
	const projectsData = await getOrgProjects(orgId);

	// Check if API returned null (error case)
	if (!projectsData) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
				<h1 className="text-2xl font-bold">Error Loading Projects</h1>
				<p className="text-muted-foreground">
					Failed to load projects for this organization. Please check your
					connection and try again.
				</p>
			</div>
		);
	}

	const projects = projectsData.projects;

	if (projects && projects.length > 0) {
		// Check for last used project first, fallback to first project
		const lastUsedProjectId = await getLastUsedProjectId(orgId);
		const defaultProjectId =
			lastUsedProjectId && projects.some((p) => p.id === lastUsedProjectId)
				? lastUsedProjectId
				: projects[0].id;

		// Redirect to the selected project
		redirect(`/dashboard/${orgId}/${defaultProjectId}`);
	}

	// If no projects found, show a message or redirect to create project
	return (
		<div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
			<h1 className="text-2xl font-bold">No Projects Found</h1>
			<p className="text-muted-foreground">
				This organization doesn&apos;t have any projects yet. Create a project
				to get started.
			</p>
		</div>
	);
}
