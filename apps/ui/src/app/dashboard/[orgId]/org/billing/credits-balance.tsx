"use client";

import { AlertCircle, CheckCircle, CreditCard } from "lucide-react";

import { useDashboardState } from "@/lib/dashboard-state";

export function CreditsBalance() {
	const { selectedOrganization } = useDashboardState();

	if (!selectedOrganization) {
		return (
			<div className="flex items-center justify-center p-8">
				<div className="flex items-center gap-2 text-muted-foreground">
					<CreditCard className="h-5 w-5" />
					<span>Loading credits...</span>
				</div>
			</div>
		);
	}

	const creditsBalance = Number(selectedOrganization.credits);
	const formattedBalance = creditsBalance.toFixed(2);

	const isLowCredits = creditsBalance < 1;
	const hasNoCredits = creditsBalance <= 0;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between p-6 border rounded-lg bg-muted/50">
				<div className="flex items-center gap-4">
					<div
						className={`p-3 rounded-full ${
							hasNoCredits
								? "bg-destructive/10"
								: isLowCredits
									? "bg-yellow-500/10"
									: "bg-green-500/10"
						}`}
					>
						<CreditCard
							className={`h-6 w-6 ${
								hasNoCredits
									? "text-destructive"
									: isLowCredits
										? "text-yellow-600"
										: "text-green-600"
							}`}
						/>
					</div>
					<div>
						<p className="text-sm text-muted-foreground font-medium">
							Available Balance
						</p>
						<p className="text-3xl font-bold">${formattedBalance}</p>
					</div>
				</div>
			</div>

			{hasNoCredits && (
				<div className="flex items-start gap-2 p-4 border border-destructive/50 rounded-lg bg-destructive/5">
					<AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
					<div>
						<p className="font-medium text-destructive">No credits remaining</p>
						<p className="text-sm text-muted-foreground mt-1">
							Your credit balance is empty. Top up now to continue using the
							service.
						</p>
					</div>
				</div>
			)}

			{isLowCredits && !hasNoCredits && (
				<div className="flex items-start gap-2 p-4 border border-yellow-500/50 rounded-lg bg-yellow-500/5">
					<AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
					<div>
						<p className="font-medium text-yellow-700">Low credits</p>
						<p className="text-sm text-muted-foreground mt-1">
							Your credit balance is running low. Consider topping up to avoid
							service interruption.
						</p>
					</div>
				</div>
			)}

			{!isLowCredits && !hasNoCredits && (
				<div className="flex items-start gap-2 p-4 border border-green-500/50 rounded-lg bg-green-500/5">
					<CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
					<div>
						<p className="font-medium text-green-700">Healthy balance</p>
						<p className="text-sm text-muted-foreground mt-1">
							Your credit balance is sufficient for continued service.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
