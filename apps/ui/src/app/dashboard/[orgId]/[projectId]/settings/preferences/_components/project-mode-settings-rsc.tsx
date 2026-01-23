import { ProjectModeSettings } from "@/components/settings/project-mode-settings";
import { fetchServerData } from "@/lib/server-api";

import type { Project } from "@/lib/types";
import type { ProjectModeSettingsData } from "@/types/settings";

interface ProjectData {
	project: Project;
}

export const ProjectModeSettingsRsc = async ({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) => {
	const projectData = await fetchServerData<ProjectData>(
		"GET",
		"/projects/{id}",
		{
			params: {
				path: {
					id: projectId,
				},
			},
		},
	);

	// Handle null data cases
	if (!projectData) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Project Mode</h3>
				<p className="text-muted-foreground text-sm">
					Unable to load project mode settings. Please try again later.
				</p>
			</div>
		);
	}

	const project = projectData.project;

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
			projectName={project.name}
		/>
	);
};
