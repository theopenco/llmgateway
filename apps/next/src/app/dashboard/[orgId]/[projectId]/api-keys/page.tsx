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
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import type { Project } from "@/lib/types";

export default function ApiKeysPage() {
	const pathname = usePathname();

	// Debug logging
	console.log("ApiKeysPage render - pathname:", pathname);

	// Extract project and org IDs directly from URL to avoid dashboard state conflicts
	const { projectId, orgId } = useMemo(() => {
		const result = extractOrgAndProjectFromPath(pathname);
		console.log("Extracted IDs:", result);
		return result;
	}, [pathname]);

	// Create a minimal project object for components that need it
	const selectedProject = useMemo((): Project | null => {
		if (!projectId || !orgId) {
			return null;
		}

		const project = {
			id: projectId,
			name: "Current Project",
			organizationId: orgId,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			cachingEnabled: false,
			cacheDurationSeconds: 0,
			mode: "api-keys" as const,
			status: "active" as const,
		};
		console.log("Created project object:", project.id);
		return project;
	}, [projectId, orgId]);

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
										Please select a project to manage API keys.
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
