"use client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { Textarea } from "@/lib/components/textarea";
import { toast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

export function OrganizationBillingEmailSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardContext();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const [billingEmail, setBillingEmail] = useState<string>(
		selectedOrganization?.billingEmail ?? "",
	);
	const [billingCompany, setBillingCompany] = useState<string>(
		selectedOrganization?.billingCompany ?? "",
	);
	const [billingAddress, setBillingAddress] = useState<string>(
		selectedOrganization?.billingAddress ?? "",
	);
	const [billingTaxId, setBillingTaxId] = useState<string>(
		selectedOrganization?.billingTaxId ?? "",
	);
	const [billingNotes, setBillingNotes] = useState<string>(
		selectedOrganization?.billingNotes ?? "",
	);

	const [emailError, setEmailError] = useState<string>("");

	// Sync state when organization changes
	React.useEffect(() => {
		if (!selectedOrganization) {
			return;
		}
		setBillingEmail(selectedOrganization.billingEmail ?? "");
		setBillingCompany(selectedOrganization.billingCompany ?? "");
		setBillingAddress(selectedOrganization.billingAddress ?? "");
		setBillingTaxId(selectedOrganization.billingTaxId ?? "");
		setBillingNotes(selectedOrganization.billingNotes ?? "");
		setEmailError("");
	}, [selectedOrganization?.id]);

	const validateEmail = (email: string): boolean => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	};

	if (!selectedOrganization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Billing Information</h3>
				<p className="text-muted-foreground text-sm">
					Please select an organization to configure billing settings.
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
				body: {
					billingEmail,
					billingCompany,
					billingAddress,
					billingTaxId,
					billingNotes,
				},
			});

			toast({
				title: "Settings saved",
				description: "Your billing information has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save billing settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Billing Information</h3>
				<p className="text-muted-foreground text-sm">
					Configure billing details for invoices and receipts
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
						This email will be used for all billing-related communications and
						invoices.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="billingCompany">Company Name (Optional)</Label>
					<Input
						id="billingCompany"
						type="text"
						placeholder="Acme Corporation"
						value={billingCompany}
						onChange={(e) => setBillingCompany(e.target.value)}
					/>
					<p className="text-sm text-muted-foreground">
						Company name to appear on invoices.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="billingAddress">Billing Address (Optional)</Label>
					<Textarea
						id="billingAddress"
						placeholder="123 Main Street&#10;Suite 100&#10;San Francisco, CA 94105&#10;United States"
						value={billingAddress}
						onChange={(e) => setBillingAddress(e.target.value)}
						rows={4}
					/>
					<p className="text-sm text-muted-foreground">
						Full billing address to appear on invoices.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="billingTaxId">Tax ID / VAT Number (Optional)</Label>
					<Input
						id="billingTaxId"
						type="text"
						placeholder="GB123456789 or VAT-123456789"
						value={billingTaxId}
						onChange={(e) => setBillingTaxId(e.target.value)}
					/>
					<p className="text-sm text-muted-foreground">
						Tax identification number to appear on invoices.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="billingNotes">Invoice Notes (Optional)</Label>
					<Textarea
						id="billingNotes"
						placeholder="Additional notes to appear at the bottom of invoices (e.g., VAT number, purchase order number)"
						value={billingNotes}
						onChange={(e) => setBillingNotes(e.target.value)}
						rows={3}
					/>
					<p className="text-sm text-muted-foreground">
						Optional notes to include at the bottom of invoices.
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
