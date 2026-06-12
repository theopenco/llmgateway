import { RoutingStrategySettings } from "@/components/settings/routing-strategy-settings";
import { fetchServerData } from "@/lib/server-api";

import type { Project } from "@/lib/types";

interface ProjectData {
	project: Project;
}

export const RoutingStrategySettingsRsc = async ({
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
			<p className="text-muted-foreground text-sm">
				Unable to load routing settings. Please try again later.
			</p>
		);
	}

	return (
		<RoutingStrategySettings
			initialStrategy={projectData.project.defaultRoutingStrategy}
			orgId={orgId}
			projectId={projectId}
		/>
	);
};
