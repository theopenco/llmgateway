import { CachingSettings } from "@/components/settings/caching-settings";
import { fetchServerData } from "@/lib/server-api";

import type { Project } from "@/lib/types";
import type { CachingSettingsData } from "@/types/settings";

interface ProjectData {
	project: Project;
}

export const CachingSettingsRsc = async ({
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
				<h3 className="text-lg font-medium">Request Caching</h3>
				<p className="text-muted-foreground text-sm">
					Unable to load caching settings. Please try again later.
				</p>
			</div>
		);
	}

	const project = projectData.project;

	// Create the initial data structure from the project data
	const initialData: CachingSettingsData = {
		preferences: {
			organizationId: orgId,
			projectId: projectId,
			preferences: {
				cachingEnabled: project.cachingEnabled,
				cacheDurationSeconds: project.cacheDurationSeconds,
			},
		},
	};

	return (
		<CachingSettings
			initialData={initialData}
			orgId={orgId}
			projectId={projectId}
			projectName={project.name}
		/>
	);
};
