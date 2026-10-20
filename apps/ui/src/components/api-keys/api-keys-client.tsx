"use client";

import { Orbit } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import {
	ApiKeysList,
	apiKeysScopeQuery,
	formatPlanLimitMessage,
	isApiKeysScopeReady,
	type ApiKeysResponse,
	type ApiKeysScope,
} from "@/components/api-keys/api-keys-list";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import { useApi } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import type { ApiKeyUsagePeriod } from "@/components/api-keys/api-key-usage-period";
import type { Project } from "@/lib/types";

/**
 * API keys page shared by the project page (one project's keys) and the
 * organization page (every project's keys, owners and admins only).
 */
export function ApiKeysClient({
	scope: scopeType,
	initialData,
	initialPeriod,
}: {
	scope: ApiKeysScope["type"];
	initialData: ApiKeysResponse | undefined;
	initialPeriod: ApiKeyUsagePeriod;
}) {
	const pathname = usePathname();
	const { selectedOrganization } = useDashboardNavigation();

	// Extract project and org IDs directly from URL to avoid dashboard state conflicts
	const { projectId, orgId } = useMemo(
		() => extractOrgAndProjectFromPath(pathname),
		[pathname],
	);

	const api = useApi();

	const { data: projectsData } = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: { id: orgId ?? "" },
			},
		},
		{
			enabled: !!orgId,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	const scope = useMemo((): ApiKeysScope => {
		const projects: Project[] = projectsData?.projects ?? [];
		if (scopeType === "organization") {
			return {
				type: "organization",
				organizationId: orgId ?? "",
				projects: projects.filter((project) => project.status !== "deleted"),
			};
		}
		return {
			type: "project",
			project: projects.find((project) => project.id === projectId) ?? null,
		};
	}, [scopeType, orgId, projectId, projectsData]);

	// Same params and initial data as the list's first view, so both share one
	// cached request.
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					...apiKeysScopeQuery(scope),
					filter: "all",
					period: initialPeriod,
				},
			},
		},
		{
			enabled: isApiKeysScopeReady(scope),
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
			...(initialData && { initialData }),
		},
	);

	const planLimits = apiKeysData?.planLimits;
	const createDisabled = planLimits
		? planLimits.currentCount >= planLimits.maxKeys
		: false;
	const canCreate =
		scope.type === "project" ? !!scope.project : scope.projects.length > 0;

	// The API enforces this; the notice only avoids a generic load error.
	if (
		scope.type === "organization" &&
		selectedOrganization &&
		!isOrganizationAdmin(selectedOrganization.role)
	) {
		return (
			<div className="text-muted-foreground p-4 pt-6 text-sm md:p-6">
				Only organization owners and admins can manage every API key in the
				organization. Manage your own keys from a project&apos;s API Keys page.
			</div>
		);
	}

	return (
		<div className="flex flex-col space-y-3 p-4 pt-6 md:p-6">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div>
					<h2 className="text-2xl font-bold tracking-tight md:text-3xl">
						API Keys
					</h2>
					<p className="text-muted-foreground text-sm">
						{scope.type === "organization"
							? "Manage the API keys of every project in this organization"
							: "Create and manage API keys to authenticate requests to LLM Gateway"}
					</p>
				</div>
				{canCreate && (
					<CreateApiKeyDialog
						{...(scope.type === "project"
							? { selectedProject: scope.project! }
							: { projects: scope.projects })}
						disabled={createDisabled}
						disabledMessage={
							planLimits ? formatPlanLimitMessage(planLimits) : undefined
						}
					>
						<Button
							disabled={createDisabled}
							className="cursor-pointer flex items-center space-x-1 w-full md:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Orbit className=" h-4 w-4 mt-0.5" />
							Create API Key
						</Button>
					</CreateApiKeyDialog>
				)}
			</div>
			<div className="md:rounded-xl md:border md:bg-card md:p-4 md:shadow-sm">
				<ApiKeysList
					scope={scope}
					initialData={initialData}
					initialPeriod={initialPeriod}
				/>
			</div>
		</div>
	);
}
