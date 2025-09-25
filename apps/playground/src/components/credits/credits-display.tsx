"use client";

import { CreditCard } from "lucide-react";

import { TopUpCreditsDialog } from "./top-up-credits-dialog";

interface Organization {
	id: string;
	name: string;
	credits: string;
	plan: "free" | "pro";
}

interface CreditsDisplayProps {
	organization: Organization | null;
	isLoading?: boolean;
}

export function CreditsDisplay({
	organization,
	isLoading,
}: CreditsDisplayProps) {
	if (isLoading) {
		return (
			<div className="px-2 py-1.5">
				<div className="w-full flex items-center justify-between p-2 rounded-md">
					<div className="flex items-center gap-2">
						<CreditCard className="h-4 w-4 text-muted-foreground" />
						<div className="flex flex-col">
							<span className="text-sm font-medium">Credits</span>
							<span className="text-xs text-muted-foreground">Loading...</span>
						</div>
					</div>
				</div>
			</div>
		);
	}

	const creditsBalance = organization
		? Number(organization.credits).toFixed(2)
		: "0.00";

	// Show different styling based on credits balance
	const isLowCredits = organization && Number(organization.credits) < 1;
	const hasNoCredits = organization && Number(organization.credits) <= 0;

	return (
		<div className="px-2 py-1.5">
			<TopUpCreditsDialog>
				<button className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-left">
					<div className="flex items-center gap-2">
						<CreditCard
							className={`h-4 w-4 ${hasNoCredits ? "text-destructive" : isLowCredits ? "text-yellow-500" : "text-muted-foreground"}`}
						/>
						<div className="flex flex-col">
							<span className="text-sm font-medium">Credits</span>
							<span
								className={`text-xs ${hasNoCredits ? "text-destructive" : isLowCredits ? "text-yellow-600" : "text-muted-foreground"}`}
							>
								${creditsBalance}
							</span>
						</div>
					</div>
					<span className="text-xs text-muted-foreground">Add</span>
				</button>
			</TopUpCreditsDialog>
			{hasNoCredits && (
				<div className="mt-1 px-2">
					<p className="text-xs text-destructive">⚠️ No credits remaining</p>
				</div>
			)}
			{isLowCredits && !hasNoCredits && (
				<div className="mt-1 px-2">
					<p className="text-xs text-yellow-600">⚡ Low credits remaining</p>
				</div>
			)}
		</div>
	);
}
