"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Checkbox } from "@/lib/components/checkbox";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";
import Spinner from "@/lib/icons/Spinner";

function AutoTopUpSettings() {
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const api = useApi();

	const { selectedOrganization } = useDashboardState();
	const { data: paymentMethods } = api.useQuery(
		"get",
		"/payments/payment-methods",
	);

	const [enabled, setEnabled] = useState(false);
	const [threshold, setThreshold] = useState(10);
	const [amount, setAmount] = useState(10);

	const { data: feeData, isLoading: feeDataLoading } = api.useQuery(
		"post",
		"/payments/calculate-fees",
		{
			body: { amount },
		},
		{
			enabled: amount >= 5,
		},
	);

	useEffect(() => {
		if (selectedOrganization) {
			setEnabled(selectedOrganization.autoTopUpEnabled ?? false);
			setThreshold(Number(selectedOrganization.autoTopUpThreshold) || 10);
			setAmount(Number(selectedOrganization.autoTopUpAmount) || 10);
		}
	}, [selectedOrganization]);

	const updateOrganization = api.useMutation("patch", "/orgs/{id}");

	const hasPaymentMethods =
		paymentMethods?.paymentMethods && paymentMethods.paymentMethods.length > 0;
	const hasDefaultPaymentMethod = paymentMethods?.paymentMethods?.some(
		(pm) => pm.isDefault,
	);

	const handleSave = async () => {
		if (enabled && !hasDefaultPaymentMethod) {
			toast({
				title: "Error",
				description:
					"Please add and set a default payment method before enabling auto top-up.",
				variant: "destructive",
			});
			return;
		}

		if (!selectedOrganization) {
			toast({
				title: "Error",
				description: "Organization not found.",
				variant: "destructive",
			});
			return;
		}

		try {
			await updateOrganization.mutateAsync({
				params: {
					path: { id: selectedOrganization.id },
				},
				body: {
					autoTopUpEnabled: enabled,
					autoTopUpThreshold: threshold,
					autoTopUpAmount: amount,
				},
			});

			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs").queryKey,
			});

			toast({
				title: "Settings saved",
				description: "Your auto top-up settings have been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save auto top-up settings.",
				variant: "destructive",
			});
		}
	};

	if (!selectedOrganization) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Auto Top-Up</CardTitle>
					<CardDescription>
						Please select an organization to manage auto top-up settings.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Auto Top-Up</CardTitle>
				<CardDescription>
					Automatically add credits when your balance falls below a threshold
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<Label htmlFor="auto-topup-enabled">Enable</Label>
						<p className="text-sm text-muted-foreground">
							Automatically charge your default payment method when credits are
							low
						</p>
					</div>
					<Checkbox
						id="auto-topup-enabled"
						checked={enabled}
						onCheckedChange={(checked) => setEnabled(!!checked)}
						disabled={!hasDefaultPaymentMethod}
					/>
				</div>

				{!hasPaymentMethods && (
					<div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
						<p className="text-sm text-yellow-800">
							You need to add a payment method before enabling auto top-up.
						</p>
					</div>
				)}

				{hasPaymentMethods && !hasDefaultPaymentMethod && (
					<div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
						<p className="text-sm text-yellow-800">
							Please set a default payment method to enable auto top-up.
						</p>
					</div>
				)}

				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="threshold">Threshold (USD)</Label>
						<Input
							id="threshold"
							type="number"
							min={5}
							value={threshold}
							onChange={(e) => setThreshold(Number(e.target.value))}
							disabled={!enabled}
						/>
						<p className="text-xs text-muted-foreground">
							Minimum $5. Top-up when credits fall below this amount.
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="amount">Top-up Amount (USD)</Label>
						<Input
							id="amount"
							type="number"
							min={10}
							value={amount}
							onChange={(e) => setAmount(Number(e.target.value))}
							disabled={!enabled}
						/>
						<p className="text-xs text-muted-foreground">
							Minimum $10. Amount to add when auto top-up triggers.
						</p>
					</div>
				</div>

				{enabled && amount >= 10 && (
					<div className="border rounded-lg p-4 bg-muted/50">
						<p className="font-medium mb-2">Estimated Auto Top-up Fees</p>
						{feeDataLoading ? (
							<div className="flex items-center justify-center py-4">
								<Spinner className="h-5 w-5 animate-spin text-muted-foreground" />
								<span className="ml-2 text-sm text-muted-foreground">
									Calculating fees...
								</span>
							</div>
						) : feeData ? (
							<div className="space-y-1 text-sm text-muted-foreground">
								<div className="flex justify-between">
									<span>Credits</span>
									<span>${feeData.baseAmount.toFixed(2)}</span>
								</div>
								<div className="flex justify-between">
									<span>Platform fee (5%)</span>
									<span>${feeData.platformFee.toFixed(2)}</span>
								</div>
								<div className="border-t pt-1 flex justify-between font-medium text-foreground">
									<span>Estimated total</span>
									<span>${feeData.totalAmount.toFixed(2)}</span>
								</div>
							</div>
						) : null}
					</div>
				)}

				<div className="flex justify-end">
					<Button
						onClick={handleSave}
						disabled={
							Boolean(updateOrganization.isPending) ||
							threshold < 5 ||
							amount < 10 ||
							(enabled && feeDataLoading)
						}
					>
						{updateOrganization.isPending ? "Saving..." : "Save Settings"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export { AutoTopUpSettings };
