import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AutoTopUpSettings } from "@/components/billing/auto-topup-settings";
import { PlanManagement } from "@/components/billing/plan-management";
import { PaymentMethodsManagement } from "@/components/credits/payment-methods-management";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import { PaymentStatusHandler } from "./payment-status-handler";

interface BillingPageProps {
	params: Promise<{
		orgId: string;
		projectId: string;
	}>;
	searchParams: Promise<{
		success?: string;
		canceled?: string;
	}>;
}

export default async function BillingPage({
	params,
	searchParams,
}: BillingPageProps) {
	const { orgId, projectId } = await params;
	const { success, canceled } = await searchParams;

	if (success || canceled) {
		const cookieStore = await cookies();
		if (success) {
			cookieStore.set("payment-status", "success", { maxAge: 10 }); // 10 seconds
		} else if (canceled) {
			cookieStore.set("payment-status", "canceled", { maxAge: 10 });
		}

		const basePath = `/dashboard/${orgId}/${projectId}/settings/billing`;
		redirect(basePath);
	}

	const cookieStore = await cookies();
	const paymentStatus = cookieStore.get("payment-status")?.value;

	return (
		<div className="flex flex-col">
			<PaymentStatusHandler paymentStatus={paymentStatus} />
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Billing</h2>
				</div>
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Plan Management</CardTitle>
							<CardDescription>
								Manage your subscription plan and billing details
							</CardDescription>
						</CardHeader>
						<CardContent>
							<PlanManagement />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Payment Methods</CardTitle>
							<CardDescription>
								Manage your payment methods and billing information
							</CardDescription>
						</CardHeader>
						<CardContent>
							<PaymentMethodsManagement />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Auto Top-up</CardTitle>
							<CardDescription>
								Configure automatic credit top-up settings
							</CardDescription>
						</CardHeader>
						<CardContent>
							<AutoTopUpSettings />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
