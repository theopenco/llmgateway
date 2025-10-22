"use client";

import { OrganizationBillingEmailSettings } from "@/components/settings/organization-billing-email-settings";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export default function PreferencesPage() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Preferences</h2>
				</div>
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
	);
}
