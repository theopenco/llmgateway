"use client";

import { CostBreakdownChart } from "@/components/usage/cost-breakdown-chart";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export function CostBreakdownCard() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Cost Breakdown</CardTitle>
				<CardDescription>
					Estimated costs by provider and storage for this project
				</CardDescription>
			</CardHeader>
			<CardContent>
				<CostBreakdownChart />
			</CardContent>
		</Card>
	);
}
