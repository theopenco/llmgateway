"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

import type { ForceThreeDSecureMode } from "@/lib/admin-settings";

const modeLabels: Record<ForceThreeDSecureMode, string> = {
	off: "Off — let Stripe decide (recommended)",
	any: "Any — request authentication whenever the issuer supports it",
	challenge: "Challenge — also ask for an interactive challenge",
};

interface ForceThreeDSecureFormProps {
	mode: ForceThreeDSecureMode;
	envOverride: ForceThreeDSecureMode | null;
	onSave: (
		mode: ForceThreeDSecureMode,
	) => Promise<{ ok: boolean; message: string | null }>;
}

export function ForceThreeDSecureForm({
	mode,
	envOverride,
	onSave,
}: ForceThreeDSecureFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const handleChange = (next: string) => {
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await onSave(next as ForceThreeDSecureMode);
			if (!result.ok) {
				setError(result.message);
				return;
			}
			setSaved(true);
			router.refresh();
		});
	};

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="force-3ds">Requested level</Label>
			<Select value={mode} disabled={pending} onValueChange={handleChange}>
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
