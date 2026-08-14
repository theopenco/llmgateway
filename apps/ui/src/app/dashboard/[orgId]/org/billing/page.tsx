import Link from "next/link";

import { AutoTopUpSettings } from "@/components/billing/auto-topup-settings";
import { PaymentMethodsManagement } from "@/components/credits/payment-methods-management";
import { TopUpCreditsButton } from "@/components/credits/top-up-credits-dialog";
import { OrganizationBillingEmailSettings } from "@/components/settings/organization-billing-email-settings";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import { CreditsBalance } from "./credits-balance";
import { PaymentStatusHandler } from "./payment-status-handler";

interface BillingPageProps {
	params: Promise<{
		orgId: string;
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
	const { orgId } = await params;
	const { success, canceled } = await searchParams;

	const paymentStatus = success ? "success" : canceled ? "canceled" : undefined;

	return (
		<div className="flex flex-col">
			<PaymentStatusHandler paymentStatus={paymentStatus} />
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<h2 className="text-3xl font-bold tracking-tight">Billing</h2>
					</div>
					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
							<div className="space-y-1.5">
								<CardTitle>Credits</CardTitle>
								<CardDescription>
									Your current credit balance and top-up options
								</CardDescription>
							</div>
							<TopUpCreditsButton />
						</CardHeader>
						<CardContent>
							<CreditsBalance />
						</CardContent>
					</Card>

					<AutoTopUpSettings />

					{/* Plan management lives on its own page now; keep a pointer here
					    for anyone who heads to Billing out of habit. */}
					<Card>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
							<div className="space-y-1.5">
								<CardTitle>Plan</CardTitle>
								<CardDescription>
									Your subscription plan, seats, and add-ons are managed on the
									Plan page.
								</CardDescription>
							</div>
							<Button variant="outline" asChild>
								<Link href={`/dashboard/${orgId}/org/plan`}>Manage plan</Link>
							</Button>
						</CardHeader>
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
							<CardTitle>Billing Email</CardTitle>
							<CardDescription>
								Manage your organization's billing email address.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<OrganizationBillingEmailSettings />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
