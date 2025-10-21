"use client";

import { OrganizationRetentionSettings } from "@/components/settings/organization-retention-settings";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export default function PoliciesPage() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Policies</h2>
				</div>
				<Card>
					<CardHeader>
						<CardTitle>Policies</CardTitle>
						<CardDescription>
							Manage your organization's data retention settings.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<OrganizationRetentionSettings />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
