"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import { RecentLogs } from "@/components/activity/recent-logs";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import type { ActivitT } from "@/types/activity";
import type { Log } from "@llmgateway/db";

interface LogsData {
	message?: string;
	logs: Log[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}

interface ActivityClientProps {
	initialLogsData?: LogsData;
	initialActivityData?: ActivitT;
}

export function ActivityClient({
	initialLogsData,
	initialActivityData,
}: ActivityClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const pathname = usePathname();
	const { buildUrl } = useDashboardNavigation();

	// Extract project ID directly from URL to avoid dashboard state conflicts
	const { projectId } = useMemo(() => {
		return extractOrgAndProjectFromPath(pathname);
	}, [pathname]);

	const daysParam = searchParams.get("days");
	const days = daysParam === "30" ? 30 : 7;

	useEffect(() => {
		if (!daysParam) {
			const params = new URLSearchParams(searchParams.toString());
			params.set("days", "7");
			router.replace(`${buildUrl("activity")}?${params.toString()}`);
		}
	}, [daysParam, searchParams, router, buildUrl]);

	// Function to update days in URL
	const updateDaysInUrl = (newDays: 7 | 30) => {
		const params = new URLSearchParams(searchParams);
		params.set("days", String(newDays));
		router.push(`${buildUrl("activity")}?${params.toString()}`);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between space-y-2">
					<h2 className="text-3xl font-bold tracking-tight">Activity</h2>
					<div className="flex items-center space-x-2">
						<Button
							variant={days === 7 ? "default" : "outline"}
							size="sm"
							onClick={() => updateDaysInUrl(7)}
						>
							7 Days
						</Button>
						<Button
							variant={days === 30 ? "default" : "outline"}
							size="sm"
							onClick={() => updateDaysInUrl(30)}
						>
							30 Days
						</Button>
					</div>
				</div>
				<div className="space-y-4">
					<ActivityChart initialData={initialActivityData} />
					<Card>
						<CardHeader>
							<div>
								<CardTitle>Recent Activity</CardTitle>
								<CardDescription>
									Your recent API requests and system events
								</CardDescription>
							</div>
						</CardHeader>
						<CardContent>
							<RecentLogs initialData={initialLogsData} projectId={projectId} />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
