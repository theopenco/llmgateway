"use client";

import { useRouter } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

interface CreditPurchaseBlockToggleProps {
	blocked: boolean;
	envForced: boolean;
}

export function CreditPurchaseBlockToggle({
	blocked,
	envForced,
}: CreditPurchaseBlockToggleProps) {
	const router = useRouter();
	const readOnly = !canWrite(useAdminRole());
	const $api = useApi();
	const mutation = $api.useMutation(
		"put",
		"/admin/settings/credit-purchase-block",
		{
			meta: { inlineError: true },
			onSettled: () => router.refresh(),
		},
	);
	const pending = mutation.isPending;
	const error = mutation.isError
		? apiErrorMessage(
				mutation.error,
				"Failed to update the setting. Try again.",
			)
		: null;

	const handleChange = (checked: boolean) => {
		mutation.mutate({ body: { blocked: checked } });
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-3">
				<Switch
					id="credit-purchase-block"
					checked={blocked}
					disabled={envForced || pending || readOnly}
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
