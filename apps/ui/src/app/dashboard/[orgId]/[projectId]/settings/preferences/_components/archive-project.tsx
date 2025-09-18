import { ArchiveProjectSettings as ArchiveProjectSettingsClient } from "@/components/settings/archive-project-settings";
import { fetchServerData } from "@/lib/server-api";

import type { Project, Organization } from "@/lib/types";

interface ProjectData {
	project: Project;
}

interface OrganizationsData {
	organizations: Organization[];
}

export const ArchiveProjectSettings = async ({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) => {
	const [projectData, organizationsData] = await Promise.all([
		fetchServerData<ProjectData>("GET", "/projects/{id}", {
			params: {
				path: {
					id: projectId,
				},
			},
		}),
		fetchServerData<OrganizationsData>("GET", "/orgs"),
	]);

	// Handle null data cases
	if (!projectData || !organizationsData) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Archive Project</h3>
				<p className="text-muted-foreground text-sm">
					Unable to load project settings. Please try again later.
				</p>
			</div>
		);
	}

	// Find the organization by ID
	const project = projectData.project;
	const organization = organizationsData.organizations.find(
		(o) => o.id === orgId,
	);

	if (!organization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Archive Project</h3>
				<p className="text-muted-foreground text-sm">Organization not found.</p>
			</div>
		);
	}

	return (
		<ArchiveProjectSettingsClient
			orgId={orgId}
			projectId={projectId}
			projectName={project.name}
		/>
	);
};
