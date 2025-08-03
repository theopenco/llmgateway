import Link from "next/link";

import { ActivityChart } from "@/components/dashboard/activity-chart";
import { Button } from "@/lib/components/button";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT } from "@/types/activity";

export const dynamic = "force-dynamic";

export default async function ModelUsagePage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{
		days?: string;
		startDate?: string;
		endDate?: string;
		finishReason?: string;
		unifiedFinishReason?: string;
		provider?: string;
		model?: string;
		limit?: string;
	}>;
}) {
	const { projectId, orgId } = await params;
	const searchParamsData = await searchParams;
	const daysParam = searchParamsData?.days;

	const days = daysParam === "30" ? 30 : 7;

	// Server-side data fetching for activity data
	const initialActivityData = await fetchServerData<ActivitT>(
		"GET",
		"/activity",
		{
			params: {
				query: {
					days: String(days),
					projectId,
				},
			},
		},
	);

	if (!initialActivityData) {
		return <div>No data found</div>;
	}

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between space-y-2">
					<h2 className="text-3xl font-bold tracking-tight">Usage by model</h2>
					<div className="flex items-center space-x-2">
						<Button
							variant={days === 7 ? "default" : "outline"}
							size="sm"
							asChild
						>
							<Link
								href={`/dashboard/${orgId}/${projectId}/model-usage?days=7`}
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
								href={`/dashboard/${orgId}/${projectId}/model-usage?days=30`}
							>
								30 Days
							</Link>
						</Button>
					</div>
				</div>
				<div className="space-y-4">
					<ActivityChart initialData={initialActivityData} />
				</div>
			</div>
		</div>
	);
}
