"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface CreditPurchaseBlockToggleProps {
	blocked: boolean;
	envForced: boolean;
	onToggle: (blocked: boolean) => Promise<{ success: boolean }>;
}

export function CreditPurchaseBlockToggle({
	blocked,
	envForced,
	onToggle,
}: CreditPurchaseBlockToggleProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	const handleChange = (checked: boolean) => {
		setError(null);
		startTransition(async () => {
			const result = await onToggle(checked);
			if (!result.success) {
				setError("Failed to update the setting. Try again.");
			}
			router.refresh();
		});
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-3">
				<Switch
					id="credit-purchase-block"
					checked={blocked}
					disabled={envForced || pending}
					onCheckedChange={handleChange}
				/>
				<Label htmlFor="credit-purchase-block">
					{blocked ? "Blocked" : "Allowed"}
				</Label>
			</div>
			{envForced && (
				<p className="text-sm text-muted-foreground">
					Forced on by the <code>DISABLE_NEW_ORG_CREDIT_PURCHASES</code>{" "}
					environment variable — the toggle is disabled until the variable is
					removed.
				</p>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}
