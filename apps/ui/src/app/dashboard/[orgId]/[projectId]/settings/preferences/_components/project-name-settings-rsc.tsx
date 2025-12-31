import { ProjectNameSettings } from "@/components/settings/project-name-settings";
import { fetchServerData } from "@/lib/server-api";

import type { Project } from "@/lib/types";

interface ProjectData {
	project: Project;
}

export const ProjectNameSettingsRsc = async ({
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

	if (!projectData) {
		return (
			<div className="space-y-2">
				<p className="text-muted-foreground text-sm">
					Unable to load project settings. Please try again later.
				</p>
			</div>
		);
	}

	return (
		<ProjectNameSettings
			projectId={projectId}
			orgId={orgId}
			initialName={projectData.project.name}
		/>
	);
};
