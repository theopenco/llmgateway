import { PlanManagement } from "@/components/billing/plan-management";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import { PlanStatusHandler } from "./plan-status-handler";

interface PlanPageProps {
	params: Promise<{
		orgId: string;
	}>;
	searchParams: Promise<{
		success?: string;
		canceled?: string;
	}>;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
	const { success, canceled } = await searchParams;

	const checkoutStatus = success
		? "success"
		: canceled
			? "canceled"
			: undefined;

	return (
		<div className="flex flex-col">
			<PlanStatusHandler checkoutStatus={checkoutStatus} />
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<h2 className="text-3xl font-bold tracking-tight">Plan</h2>
					</div>
					<Card>
						<CardHeader>
							<CardTitle>Plan Management</CardTitle>
							<CardDescription>
								Manage your subscription plan, seats, and add-ons
							</CardDescription>
						</CardHeader>
						<CardContent>
							<PlanManagement />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
