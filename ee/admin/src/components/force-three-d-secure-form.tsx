"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import type { ForceThreeDSecureMode } from "@/lib/admin-settings";

const modeLabels: Record<ForceThreeDSecureMode, string> = {
	off: "Off — let Stripe decide (recommended)",
	any: "Any — request authentication whenever the issuer supports it",
	challenge: "Challenge — also ask for an interactive challenge",
};

interface ForceThreeDSecureFormProps {
	mode: ForceThreeDSecureMode;
	envOverride: ForceThreeDSecureMode | null;
}

export function ForceThreeDSecureForm({
	mode,
	envOverride,
}: ForceThreeDSecureFormProps) {
	const router = useRouter();
	const readOnly = !canWrite(useAdminRole());
	const $api = useApi();
	const [saved, setSaved] = useState(false);
	const mutation = $api.useMutation("put", "/admin/settings/force-3ds", {
		meta: { inlineError: true },
		onSuccess: () => {
			setSaved(true);
			router.refresh();
		},
	});
	const pending = mutation.isPending;
	const error = mutation.isError
		? apiErrorMessage(mutation.error, "Failed to update the 3D Secure setting.")
		: null;

	const handleChange = (next: string) => {
		setSaved(false);
		mutation.mutate({ body: { mode: next as ForceThreeDSecureMode } });
	};

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="force-3ds">Requested level</Label>
			<Select
				value={mode}
				disabled={pending || readOnly}
				onValueChange={handleChange}
			>
				<SelectTrigger id="force-3ds" className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{Object.entries(modeLabels).map(([value, label]) => (
						<SelectItem key={value} value={value}>
							{label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{envOverride && (
				<p className="text-sm text-muted-foreground">
					Overridden by the <code>STRIPE_FORCE_3DS</code> environment variable,
					which is set to <code>{envOverride}</code>. Card flows use that level
					regardless of the value selected here until the variable is removed.
				</p>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
			{saved && !error && (
				<p className="text-sm text-muted-foreground">Saved.</p>
			)}
		</div>
	);
}
