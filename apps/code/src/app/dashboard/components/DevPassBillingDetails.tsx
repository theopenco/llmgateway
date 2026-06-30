"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type BillingDetails =
	paths["/dev-plans/billing-details"]["get"]["responses"]["200"]["content"]["application/json"];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DevPassBillingDetailsProps {
	// When rendered inside the billing-details dialog the surrounding chrome
	// (heading + card border) is provided by the dialog, so it is omitted here.
	embedded?: boolean;
	// Called after a successful save (used to close the dialog).
	onSaved?: () => void;
}

export default function DevPassBillingDetails({
	embedded,
	onSaved,
}: DevPassBillingDetailsProps = {}) {
	const api = useApi();
	const { data } = api.useQuery("get", "/dev-plans/billing-details", {});

	if (!data) {
		return embedded ? (
			<div className="flex justify-center py-8">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		) : null;
	}

	return (
		<BillingDetailsForm data={data} embedded={embedded} onSaved={onSaved} />
	);
}

function BillingDetailsForm({
	data,
	embedded,
	onSaved,
}: {
	data: BillingDetails;
	embedded?: boolean;
	onSaved?: () => void;
}) {
	const api = useApi();
	const queryClient = useQueryClient();

	const updateMutation = api.useMutation("patch", "/dev-plans/billing-details");

	const [useDefault, setUseDefault] = useState(!data.devPlanBillingOverride);
	const [billingEmail, setBillingEmail] = useState(data.own.billingEmail ?? "");
	const [billingCompany, setBillingCompany] = useState(
		data.own.billingCompany ?? "",
	);
	const [billingAddress, setBillingAddress] = useState(
		data.own.billingAddress ?? "",
	);
	const [billingTaxId, setBillingTaxId] = useState(data.own.billingTaxId ?? "");
	const [billingNotes, setBillingNotes] = useState(data.own.billingNotes ?? "");
	const [emailError, setEmailError] = useState("");

	// When using the org default, show the resolved default-org values
	// (read-only) so the form previews exactly what will appear on invoices.
	const fields = useDefault
		? {
				billingEmail: data.default.billingEmail ?? "",
				billingCompany: data.default.billingCompany ?? "",
				billingAddress: data.default.billingAddress ?? "",
				billingTaxId: data.default.billingTaxId ?? "",
				billingNotes: data.default.billingNotes ?? "",
			}
		: {
				billingEmail,
				billingCompany,
				billingAddress,
				billingTaxId,
				billingNotes,
			};

	const invalidate = () =>
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				return Array.isArray(key) && key[1] === "/dev-plans/billing-details";
			},
		});

	const handleSave = async () => {
		const body: {
			devPlanBillingOverride: boolean;
			billingEmail?: string;
			billingCompany?: string;
			billingAddress?: string;
			billingTaxId?: string;
			billingNotes?: string;
		} = { devPlanBillingOverride: !useDefault };

		if (!useDefault) {
			if (!billingEmail.trim()) {
				setEmailError("Billing email is required");
				return;
			}
			if (!EMAIL_REGEX.test(billingEmail)) {
				setEmailError("Please enter a valid email address");
				return;
			}
			body.billingEmail = billingEmail;
			body.billingCompany = billingCompany;
			body.billingAddress = billingAddress;
			body.billingTaxId = billingTaxId;
			body.billingNotes = billingNotes;
		}

		setEmailError("");

		try {
			await updateMutation.mutateAsync({ body });
			await invalidate();
			toast.success("Billing details saved");
			onSaved?.();
		} catch {
			toast.error("Failed to save billing details");
		}
	};

	return (
		<div>
			{!embedded && (
				<>
					<h2 className="mb-1 font-semibold">Billing details</h2>
					<p className="mb-4 text-sm text-muted-foreground">
						These details appear on your DevPass invoices.
					</p>
				</>
			)}

			<div
				className={embedded ? "space-y-5" : "rounded-xl border p-5 space-y-5"}
			>
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-0.5">
						<Label
							htmlFor="use-default-billing"
							className="text-sm font-medium"
						>
							Use my LLM Gateway organization billing details
						</Label>
						<p className="text-xs text-muted-foreground">
							These come from your LLM Gateway organization settings. Turn off
							to set custom details for DevPass invoices.
						</p>
					</div>
					<Switch
						id="use-default-billing"
						checked={useDefault}
						onCheckedChange={(checked) => {
							setUseDefault(checked);
							setEmailError("");
						}}
					/>
				</div>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="dp-billingEmail">Email address</Label>
						<Input
							id="dp-billingEmail"
							type="email"
							placeholder="billing@company.com"
							value={fields.billingEmail}
							disabled={useDefault}
							onChange={(e) => {
								setBillingEmail(e.target.value);
								setEmailError("");
							}}
							className={emailError ? "border-destructive" : ""}
						/>
						{emailError && (
							<p className="text-sm text-destructive">{emailError}</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="dp-billingCompany">Company name (optional)</Label>
						<Input
							id="dp-billingCompany"
							type="text"
							placeholder="Acme Corporation"
							value={fields.billingCompany}
							disabled={useDefault}
							onChange={(e) => setBillingCompany(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="dp-billingAddress">
							Billing address (optional)
						</Label>
						<Textarea
							id="dp-billingAddress"
							placeholder={
								"123 Main Street\nSuite 100\nSan Francisco, CA 94105\nUnited States"
							}
							value={fields.billingAddress}
							disabled={useDefault}
							onChange={(e) => setBillingAddress(e.target.value)}
							rows={4}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="dp-billingTaxId">
							Tax ID / VAT number (optional)
						</Label>
						<Input
							id="dp-billingTaxId"
							type="text"
							placeholder="GB123456789 or VAT-123456789"
							value={fields.billingTaxId}
							disabled={useDefault}
							onChange={(e) => setBillingTaxId(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="dp-billingNotes">Invoice notes (optional)</Label>
						<Textarea
							id="dp-billingNotes"
							placeholder="Additional notes to appear at the bottom of invoices (e.g., purchase order number)"
							value={fields.billingNotes}
							disabled={useDefault}
							onChange={(e) => setBillingNotes(e.target.value)}
							rows={3}
						/>
					</div>
				</div>

				<div className="flex justify-end">
					<Button onClick={handleSave} disabled={updateMutation.isPending}>
						{updateMutation.isPending ? "Saving..." : "Save billing details"}
					</Button>
				</div>
			</div>
		</div>
	);
}
