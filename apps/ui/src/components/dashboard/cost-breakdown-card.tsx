"use client";

import { CostBreakdownChart } from "@/components/usage/cost-breakdown-chart";
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
	return (
		<Card>
			<CardHeader>
				<CardTitle>Cost Breakdown</CardTitle>
				<CardDescription>
					Estimated costs by provider and storage for this project
				</CardDescription>
			</CardHeader>
			<CardContent>
				<CostBreakdownChart initialData={initialActivityData} />
			</CardContent>
		</Card>
	);
}
