"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/lib/components/button";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

interface PaymentStatusHandlerProps {
	paymentStatus?: string;
}

export function PaymentStatusHandler({
	paymentStatus,
}: PaymentStatusHandlerProps) {
	const { toast } = useToast();
	const posthog = usePostHog();
	const api = useApi();
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardState();
	const handled = useRef(false);
	const [showNudge, setShowNudge] = useState(false);
	const [autoTopUpEnabled, setAutoTopUpEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const updateOrganization = api.useMutation("patch", "/orgs/{id}");

	const alreadyHasAutoTopUp = selectedOrganization?.autoTopUpEnabled ?? false;

	useEffect(() => {
		if (handled.current) {
			return;
		}
		if (!paymentStatus) {
			return;
		}

		handled.current = true;

		if (paymentStatus === "success") {
			toast({
				title: "Payment successful",
				description: "Your payment has been processed successfully.",
			});
			if (!alreadyHasAutoTopUp) {
				setShowNudge(true);
				posthog.capture("auto_topup_nudge_shown");
			}
		} else if (paymentStatus === "canceled") {
			toast({
				title: "Payment canceled",
				description: "Your payment was canceled.",
				variant: "destructive",
			});
		}
	}, [paymentStatus, toast, alreadyHasAutoTopUp, posthog]);

	const handleEnable = async () => {
		if (!selectedOrganization) {
			return;
		}
		setSaving(true);
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: {
					autoTopUpEnabled: true,
					autoTopUpThreshold: 5,
					autoTopUpAmount: 20,
				},
			});
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs").queryKey,
			});
			posthog.capture("auto_topup_nudge_enabled");
			toast({
				title: "Auto top-up enabled",
				description:
					"Credits will automatically reload $20 when your balance drops below $5.",
			});
		} catch {
			toast({
				title: "Could not enable auto top-up",
				description: "You can enable it later in billing settings.",
				variant: "destructive",
			});
		} finally {
			setSaving(false);
			setShowNudge(false);
		}
	};

	const handleDismiss = () => {
		posthog.capture("auto_topup_nudge_dismissed");
		setShowNudge(false);
	};

	if (!showNudge) {
		return null;
	}

	return (
		<div className="mx-auto max-w-3xl px-4 pt-6 md:px-8">
			<div className="border rounded-lg p-4 bg-muted/50 space-y-3">
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<p className="font-medium">Never run out of credits</p>
						<p className="text-sm text-muted-foreground">
							Auto-reload $20 when balance drops below $5
						</p>
					</div>
					<Switch
						checked={autoTopUpEnabled}
						onCheckedChange={(checked) =>
							setAutoTopUpEnabled(checked as boolean)
						}
					/>
				</div>
				<div className="flex gap-2 justify-end">
					<Button variant="outline" size="sm" onClick={handleDismiss}>
						Dismiss
					</Button>
					<Button
						size="sm"
						onClick={autoTopUpEnabled ? handleEnable : handleDismiss}
						disabled={saving}
					>
						{saving ? "Saving..." : "Continue"}
					</Button>
				</div>
			</div>
		</div>
	);
}
