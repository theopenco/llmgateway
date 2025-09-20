"use client";

import { Orbit } from "lucide-react";
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
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import type { Project, ApiKey } from "@/lib/types";

export function ApiKeysClient({ initialData }: { initialData: ApiKey[] }) {
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

	// Get API keys data to check plan limits
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: { projectId: selectedProject?.id || "" },
			},
		},
		{
			enabled: !!selectedProject?.id,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	const planLimits = apiKeysData?.planLimits;

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">API Keys</h2>
						<p className="text-muted-foreground">
							Create and manage API keys to authenticate requests to LLM Gateway
						</p>
					</div>
					{selectedProject && (
						<CreateApiKeyDialog
							selectedProject={selectedProject}
							disabled={
								planLimits
									? planLimits.currentCount >= planLimits.maxKeys
									: false
							}
							disabledMessage={
								planLimits
									? `${planLimits.plan === "pro" ? "Pro" : "Free"} plan allows maximum ${planLimits.maxKeys} API keys per project`
									: undefined
							}
						>
							<Button
								disabled={
									!selectedProject ||
									(planLimits
										? planLimits.currentCount >= planLimits.maxKeys
										: false)
								}
								className="cursor-pointer flex items-center space-x-1 w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<Orbit className=" h-4 w-4 mt-0.5" />
								Create API Key
							</Button>
						</CreateApiKeyDialog>
					)}
				</div>
				<div className="space-y-4">
					{/* Desktop Card */}
					<div className="hidden md:block">
						<Card className="gap-0">
							<CardHeader>
								<CardDescription>
									{!selectedProject && (
										<span className="text-amber-600">
											Loading project information...
										</span>
									)}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<ApiKeysList
									selectedProject={selectedProject}
									initialData={initialData}
								/>
							</CardContent>
						</Card>
					</div>

					{/* Mobile - Direct rendering */}
					<div className="md:hidden">
						{!selectedProject && (
							<div className="text-amber-600 mb-4">
								Loading project information...
							</div>
						)}
						<ApiKeysList
							selectedProject={selectedProject}
							initialData={initialData}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
