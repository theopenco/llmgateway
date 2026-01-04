import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

interface UpgradeToProDialogProps {
	children: React.ReactNode;
	initialBillingCycle?: "monthly" | "yearly";
}

export function UpgradeToProDialog({
	children,
	initialBillingCycle = "monthly",
}: UpgradeToProDialogProps) {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent>
				<UpgradeDialogContent initialBillingCycle={initialBillingCycle} />
			</DialogContent>
		</Dialog>
	);
}

function UpgradeDialogContent({
	initialBillingCycle = "monthly",
}: {
	initialBillingCycle?: "monthly" | "yearly";
}) {
	const [loading, setLoading] = useState(false);
	const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(
		initialBillingCycle,
	);
	const { toast } = useToast();

	const api = useApi();
	const createSubscriptionMutation = api.useMutation(
		"post",
		"/subscriptions/create-pro-subscription",
	);

	const handleUpgrade = async () => {
		setLoading(true);

		try {
			const { checkoutUrl } = await createSubscriptionMutation.mutateAsync({
				body: {
					billingCycle,
				},
			});

			// Redirect to Stripe Checkout
			window.location.href = checkoutUrl;
		} catch (error: any) {
			toast({
				title: "Error",
				description:
					(error as any)?.message ||
					"Failed to start checkout. Please try again.",
				variant: "destructive",
			});
			setLoading(false);
		}
	};

	const monthlyPrice = 50;
	const yearlyPrice = 500;
	const discount = Math.round(
		((monthlyPrice * 12 - yearlyPrice) / (monthlyPrice * 12)) * 100,
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle>Upgrade to Pro</DialogTitle>
				<DialogDescription>
					Unlock provider keys and get full access to all features.
				</DialogDescription>
			</DialogHeader>
			<div className="py-4 space-y-4">
				{/* Billing Cycle Toggle */}
				<div className="flex items-center justify-center space-x-4">
					<Label
						htmlFor="billing-toggle"
						className={
							billingCycle === "monthly"
								? "font-medium"
								: "text-muted-foreground"
						}
					>
						Monthly
					</Label>
					<Switch
						id="billing-toggle"
						checked={billingCycle === "yearly"}
						onCheckedChange={(checked: boolean) =>
							setBillingCycle(checked ? "yearly" : "monthly")
						}
					/>
					<div className="flex items-center">
						<Label
							htmlFor="billing-toggle"
							className={
								billingCycle === "yearly"
									? "font-medium"
									: "text-muted-foreground"
							}
						>
							Annual
						</Label>
						<Badge variant="secondary" className="ml-2">
							Save {discount}%
						</Badge>
					</div>
				</div>

				{/* Price Display */}
				<div className="text-center">
					<div className="text-3xl font-bold">
						${billingCycle === "monthly" ? monthlyPrice : yearlyPrice}
					</div>
					<div className="text-sm text-muted-foreground">
						{billingCycle === "monthly" ? "per month" : "per year"}
					</div>
				</div>

				<div className="border rounded-lg p-4 space-y-3">
					<h4 className="font-medium">What you'll get:</h4>
					<ul className="space-y-2 text-sm">
						<li className="flex items-center gap-2">
							<div className="w-2 h-2 rounded-full bg-green-500" />
							Use your own OpenAI, Anthropic, and other provider API keys
						</li>
						<li className="flex items-center gap-2">
							<div className="w-2 h-2 rounded-full bg-green-500" />
							Hybrid mode: fallback to credits when needed
						</li>
						<li className="flex items-center gap-2">
							<div className="w-2 h-2 rounded-full bg-green-500" />
							Team management: invite and manage team members
						</li>
						<li className="flex items-center gap-2">
							<div className="w-2 h-2 rounded-full bg-green-500" />
							No surcharges for API keys, 80% less fees on credits (1% vs 5%)
						</li>
						<li className="flex items-center gap-2">
							<div className="w-2 h-2 rounded-full bg-green-500" />
							All existing features (credits, analytics, etc.)
						</li>
					</ul>
				</div>
			</div>
			<DialogFooter>
				<div className="flex flex-col gap-2 items-end">
					<Button
						onClick={handleUpgrade}
						disabled={loading || createSubscriptionMutation.isPending}
					>
						{loading || createSubscriptionMutation.isPending
							? "Redirecting to checkout..."
							: `Start 7-day free trial`}
					</Button>
					<div className="text-sm text-muted-foreground">
						<p>You'll be redirected to Stripe Checkout to complete payment.</p>
					</div>
				</div>
			</DialogFooter>
		</>
	);
}
