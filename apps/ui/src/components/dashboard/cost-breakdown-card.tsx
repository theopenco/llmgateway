"use client";

import { CostBreakdownChart } from "@/components/usage/cost-breakdown-chart";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import type { ActivitT } from "@/types/activity";

interface CostBreakdownCardProps {
	initialActivityData?: ActivitT;
}

export function CostBreakdownCard({
	initialActivityData,
}: CostBreakdownCardProps) {
	const { selectedProject } = useDashboardNavigation();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Cost Breakdown</CardTitle>
				<CardDescription>
					Estimated costs by provider and storage for this project
				</CardDescription>
			</CardHeader>
			<CardContent className="h-[350px]">
				<CostBreakdownChart
					initialData={initialActivityData}
					projectId={selectedProject?.id}
				/>
			</CardContent>
		</Card>
	);
}
