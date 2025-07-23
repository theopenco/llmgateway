"use client";

import { Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { ApiKeysList } from "@/components/api-keys/api-keys-list";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import type { Project } from "@/lib/types";

export default function ApiKeysPage() {
	const pathname = usePathname();

	// Extract project and org IDs directly from URL to avoid dashboard state conflicts
	const { projectId, orgId } = useMemo(() => {
		const result = extractOrgAndProjectFromPath(pathname);
		return result;
	}, [pathname]);

	// Fetch actual project data instead of using mock values
	const api = useApi();

	const { data: projectsData } = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: { id: orgId || "" },
			},
		},
		{
			enabled: !!orgId,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	// Find the actual project from the fetched data
	const selectedProject = useMemo((): Project | null => {
		if (!projectId || !projectsData?.projects) {
			return null;
		}

		const actualProject = projectsData.projects.find(
			(p: Project) => p.id === projectId,
		);
		return actualProject || null;
	}, [projectId, projectsData]);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between space-y-2">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">API Keys</h2>
						<p className="text-muted-foreground">
							Manage your API keys for accessing LLM Gateway
						</p>
					</div>
					{selectedProject && (
						<CreateApiKeyDialog selectedProject={selectedProject}>
							<Button disabled={!selectedProject}>
								<Plus className="mr-2 h-4 w-4" />
								Create API Key
							</Button>
						</CreateApiKeyDialog>
					)}
				</div>
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Your API Keys</CardTitle>
							<CardDescription>
								API keys allow you to authenticate with the LLM Gateway API.
								{!selectedProject && (
									<span className="block mt-2 text-amber-600">
										Loading project information...
									</span>
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ApiKeysList selectedProject={selectedProject} />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
