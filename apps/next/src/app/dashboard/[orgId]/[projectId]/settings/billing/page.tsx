"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { AutoTopUpSettings } from "@/components/billing/auto-topup-settings";
import { PlanManagement } from "@/components/billing/plan-management";
import { PaymentMethodsManagement } from "@/components/credits/payment-methods-management";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useToast } from "@/lib/components/use-toast";

export default function BillingPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { toast } = useToast();
	const { buildUrl } = useDashboardNavigation();

	const success = searchParams.get("success");
	const canceled = searchParams.get("canceled");

	useEffect(() => {
		if (success) {
			toast({
				title: "Payment successful",
				description: "Your payment has been processed successfully.",
			});
			// Clean up the URL
			router.replace(buildUrl("settings/billing"));
		}
		if (canceled) {
			toast({
				title: "Payment canceled",
				description: "Your payment was canceled.",
				variant: "destructive",
			});
			// Clean up the URL
			router.replace(buildUrl("settings/billing"));
		}
	}, [success, canceled, toast, router, buildUrl]);

	return (
		<div className="flex flex-col">
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
