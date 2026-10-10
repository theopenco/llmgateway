"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ContactSalesLink } from "@/components/contact-sales";
import { Alert, AlertDescription } from "@/lib/components/alert";
import { Button } from "@/lib/components/button";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Separator } from "@/lib/components/separator";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function OrganizationRetentionSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardState();
	const { hosted } = useAppConfig();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const [retentionLevel, setRetentionLevel] = useState<"retain" | "none">(
		selectedOrganization?.retentionLevel ?? "retain",
	);
	useEffect(() => {
		setRetentionLevel(selectedOrganization?.retentionLevel ?? "retain");
	}, [selectedOrganization?.id, selectedOrganization?.retentionLevel]);

	const zeroDataRetentionEnabled =
		selectedOrganization?.providerCompliancePolicy?.enabled === true &&
		selectedOrganization.providerCompliancePolicy.zeroDataRetention === true;
	const effectiveRetentionLevel = zeroDataRetentionEnabled
		? "none"
		: retentionLevel;
	// Payload retention is Enterprise-only. Existing non-Enterprise orgs that
	// still retain payloads keep the setting or turn it off, but cannot
	// re-enable it. The hosted platform switches them to Metadata Only on
	// 2026-11-08; self-hosted installs are left alone.
	const isEnterprise = selectedOrganization?.enterpriseAccess === true;
	const retainLocked =
		!isEnterprise && selectedOrganization?.retentionLevel !== "retain";
	const retainTransitionNotice =
		hosted &&
		!isEnterprise &&
		selectedOrganization?.retentionLevel === "retain";

	if (!selectedOrganization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Data Retention</h3>
				<p className="text-muted-foreground text-sm">
					Please select an organization to configure data retention settings.
				</p>
			</div>
		);
	}

	const handleSave = async () => {
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: { retentionLevel: effectiveRetentionLevel },
			});

			toast({
				title: "Settings saved",
				description: "Your data retention settings have been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save data retention settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Data Retention</h3>
				<p className="text-muted-foreground text-sm">
					Configure how request payloads and AI responses are stored
				</p>
				{selectedOrganization && (
					<p className="text-muted-foreground text-sm mt-1">
						Organization: {selectedOrganization.name}
					</p>
				)}
			</div>

			<Separator />

			<div className="space-y-4">
				{zeroDataRetentionEnabled ? (
					<Alert>
						<AlertDescription>
							<strong>Zero data retention is active.</strong> Prompt payloads
							and Responses API state are not stored.{` `}
							<span className="sm:whitespace-nowrap">
								Disable ZDR in{` `}
								<Link
									href={`/dashboard/${selectedOrganization.id}/org/compliance`}
									className="font-semibold underline hover:no-underline"
								>
									Compliance settings
								</Link>
								{` `}to enable retention.
							</span>
						</AlertDescription>
					</Alert>
				) : retainLocked ? (
					<Alert>
						<AlertDescription>
							<strong>Retain All Data requires an Enterprise plan.</strong>
							{` `}
							Full request and response payloads are only stored on Enterprise;
							other organizations keep Metadata Only (timestamps, models, token
							counts, costs, and latency).{` `}
							<span className="sm:whitespace-nowrap">
								<a
									href="https://llmgateway.io/enterprise"
									target="_blank"
									rel="noopener noreferrer"
									className="font-semibold underline hover:no-underline"
								>
									Explore Enterprise
								</a>
								{` `}or{` `}
								<ContactSalesLink className="font-semibold underline hover:no-underline">
									contact us
								</ContactSalesLink>
								{` `}to upgrade.
							</span>
						</AlertDescription>
					</Alert>
				) : retainTransitionNotice ? (
					<Alert variant="destructive">
						<AlertDescription>
							<strong>
								Payload retention for this organization ends on November 8,
								2026.
							</strong>
							{` `}
							Retain All Data is now an Enterprise-only feature. On that date
							this organization will switch to Metadata Only automatically
							unless it upgrades to Enterprise. You can switch to Metadata Only
							earlier, but Retain All Data cannot be re-enabled afterwards
							without Enterprise.{` `}
							<span className="sm:whitespace-nowrap">
								<a
									href="https://llmgateway.io/enterprise"
									target="_blank"
									rel="noopener noreferrer"
									className="font-semibold underline hover:no-underline"
								>
									Explore Enterprise
								</a>
								{` `}or{` `}
								<ContactSalesLink className="font-semibold underline hover:no-underline">
									contact us
								</ContactSalesLink>
								{` `}to keep it.
							</span>
						</AlertDescription>
					</Alert>
				) : null}
				<RadioGroup
					value={effectiveRetentionLevel}
					onValueChange={(value: "retain" | "none") => setRetentionLevel(value)}
					className="space-y-2"
				>
					{[
						{
							id: "retain",
							label: "Retain All Data",
							desc: "Save request payloads and AI responses along with metadata",
						},
						{
							id: "none",
							label: "Metadata Only",
							desc: "Save only metadata, pricing, and usage data (exclude request payloads and responses)",
						},
					].map(({ id, label, desc }) => (
						<div key={id} className="flex items-start space-x-2">
							<RadioGroupItem
								value={id}
								id={id}
								disabled={
									(zeroDataRetentionEnabled || retainLocked) && id === "retain"
								}
							/>
							<div className="space-y-1 flex-1">
								<Label htmlFor={id} className="font-medium">
									{label}
								</Label>
								<p className="text-sm text-muted-foreground">{desc}</p>
							</div>
						</div>
					))}
				</RadioGroup>

				{effectiveRetentionLevel === "retain" && (
					<>
						<Alert>
							<AlertDescription>
								<strong>Data Retention Period:</strong> Retained data is
								automatically cleaned up after 30 days. Enterprise plans can be
								configured with unlimited retention.
								<p className="mt-2">
									<strong>Data storage is billed at $0.01 per 1M tokens</strong>{" "}
									(includes input, cached, output, and reasoning tokens).
								</p>
							</AlertDescription>
						</Alert>
						<Alert>
							<AlertDescription>
								<p>
									<strong>💡 Tip:</strong> Storage costs are deducted from
									credits in real-time. We recommend enabling auto top-up in{" "}
									<Link
										href={`/dashboard/${selectedOrganization?.id}/org/billing`}
										className="underline font-semibold hover:no-underline"
									>
										billing settings
									</Link>{" "}
									to prevent request failures when credits run out.
								</p>
							</AlertDescription>
						</Alert>
					</>
				)}
			</div>

			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateOrganization.isPending}>
					{updateOrganization.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
