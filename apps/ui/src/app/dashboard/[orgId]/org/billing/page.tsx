import { AutoTopUpSettings } from "@/components/billing/auto-topup-settings";
import { PlanManagement } from "@/components/billing/plan-management";
import { PaymentMethodsManagement } from "@/components/credits/payment-methods-management";
import { TopUpCreditsButton } from "@/components/credits/top-up-credits-dialog";
import { UnauthorizedView } from "@/components/dashboard/unauthorized-view";
import { OrganizationBillingEmailSettings } from "@/components/settings/organization-billing-email-settings";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { getOrganizations } from "@/lib/server-api";

import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

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
	const [{ orgId }, { success, canceled }, data] = await Promise.all([
		params,
		searchParams,
		getOrganizations(),
	]);
	if (
		!isOrganizationAdmin(
			data?.organizations.find((org) => org.id === orgId)?.role,
		)
	) {
		return <UnauthorizedView resource="organization" />;
	}

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
