import { ProjectModeSettings } from "@/components/settings/project-mode-settings";
import { fetchServerData } from "@/lib/server-api";

import type { Project, Organization } from "@/lib/types";
import type { ProjectModeSettingsData } from "@/types/settings";

interface ProjectData {
	project: Project;
}

interface OrganizationsData {
	organizations: Organization[];
}

export const ProjectModeSettingsRsc = async ({
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
				<h3 className="text-lg font-medium">Project Mode</h3>
				<p className="text-muted-foreground text-sm">
					Unable to load project mode settings. Please try again later.
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
				<h3 className="text-lg font-medium">Project Mode</h3>
				<p className="text-muted-foreground text-sm">Organization not found.</p>
			</div>
		);
	}

	// Create the initial data structure
	const initialData: ProjectModeSettingsData = {
		project: {
			id: project.id,
			name: project.name,
			mode: project.mode,
		},
	};

	return (
		<ProjectModeSettings
			initialData={initialData}
			orgId={orgId}
			projectId={projectId}
			organizationPlan={organization.plan}
			projectName={project.name}
		/>
	);
};
