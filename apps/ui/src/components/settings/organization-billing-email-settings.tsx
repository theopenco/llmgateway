"use client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { toast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function OrganizationBillingEmailSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardState();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const [billingEmail, setBillingEmail] = useState<string>(
		selectedOrganization?.billingEmail || "",
	);

	const [emailError, setEmailError] = useState<string>("");

	const validateEmail = (email: string): boolean => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	};

	if (!selectedOrganization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Billing Email</h3>
				<p className="text-muted-foreground text-sm">
					Please select an organization to configure billing email settings.
				</p>
			</div>
		);
	}

	const handleSave = async () => {
		if (!billingEmail.trim()) {
			setEmailError("Billing email is required");
			return;
		}

		if (!validateEmail(billingEmail)) {
			setEmailError("Please enter a valid email address");
			return;
		}

		setEmailError("");

		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: { billingEmail },
			});

			toast({
				title: "Settings saved",
				description: "Your billing email has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save billing email settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Billing Email</h3>
				<p className="text-muted-foreground text-sm">
					Configure the email address used for billing communications and
					receipts
				</p>
				{selectedOrganization && (
					<p className="text-muted-foreground text-sm mt-1">
						Organization: {selectedOrganization.name}
					</p>
				)}
			</div>

			<Separator />

			<div className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="billingEmail">Email Address</Label>
					<Input
						id="billingEmail"
						type="email"
						placeholder="billing@company.com"
						value={billingEmail}
						onChange={(e) => {
							setBillingEmail(e.target.value);
							setEmailError("");
						}}
						className={emailError ? "border-destructive" : ""}
					/>
					{emailError && (
						<p className="text-sm text-destructive">{emailError}</p>
					)}
					<p className="text-sm text-muted-foreground">
						This email will be used for all billing-related communications,
						invoices, and receipts from Stripe.
					</p>
				</div>
			</div>

			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateOrganization.isPending}>
					{updateOrganization.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
