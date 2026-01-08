"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { ActivityChart } from "@/components/dashboard/activity-chart";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";

import type { ActivitT } from "@/types/activity";

interface ModelUsageClientProps {
	initialActivityData?: ActivitT;
	orgId: string;
	projectId: string;
}

export function ModelUsageClient({
	initialActivityData,
	orgId,
	projectId,
}: ModelUsageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();

	// Fetch API keys for the project
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					projectId: projectId || "",
				},
			},
		},
		{
			enabled: !!projectId,
		},
	);

	const apiKeys =
		apiKeysData?.apiKeys.filter((key) => key.status !== "deleted") || [];

	// Get days from URL parameter
	const daysParam = searchParams.get("days");
	const days = daysParam === "30" ? 30 : 7;

	// Get apiKeyId from URL
	const apiKeyId = searchParams.get("apiKeyId") || undefined;

	// Function to update apiKeyId in URL
	const updateApiKeyIdInUrl = (newApiKeyId: string | undefined) => {
		const params = new URLSearchParams(searchParams);
		if (newApiKeyId) {
			params.set("apiKeyId", newApiKeyId);
		} else {
			params.delete("apiKeyId");
		}
		router.push(`${buildUrl("model-usage")}?${params.toString()}`);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between space-y-2">
					<h2 className="text-3xl font-bold tracking-tight">Usage by model</h2>
					<div className="flex items-center space-x-2">
						<Select
							value={apiKeyId || "all"}
							onValueChange={(value) =>
								updateApiKeyIdInUrl(value === "all" ? undefined : value)
							}
						>
							<SelectTrigger size="sm" className="w-[180px]">
								<SelectValue placeholder="All API Keys" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All API Keys</SelectItem>
								{apiKeys.map((key) => (
									<SelectItem key={key.id} value={key.id}>
										{key.description}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							variant={days === 7 ? "default" : "outline"}
							size="sm"
							asChild
						>
							<Link
								href={`/dashboard/${orgId}/${projectId}/model-usage?days=7${apiKeyId ? `&apiKeyId=${apiKeyId}` : ""}`}
							>
								7 Days
							</Link>
						</Button>
						<Button
							variant={days === 30 ? "default" : "outline"}
							size="sm"
							asChild
						>
							<Link
								href={`/dashboard/${orgId}/${projectId}/model-usage?days=30${apiKeyId ? `&apiKeyId=${apiKeyId}` : ""}`}
							>
								30 Days
							</Link>
						</Button>
					</div>
				</div>
				<div className="space-y-4">
					<ActivityChart
						initialData={apiKeyId ? undefined : initialActivityData}
						apiKeyId={apiKeyId}
					/>
				</div>
			</div>
		</div>
	);
}
