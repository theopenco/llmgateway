"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { MultiProviderSelector } from "@llmgateway/shared/components";

import type { ContentFilterSettingsInput } from "@/lib/admin-settings";

interface ContentFilterProvider {
	id: string;
	name: string;
	color: string | null;
	enabled: boolean;
}

interface ContentFilterSettingsFormProps {
	settings: {
		enabled: boolean;
		sampleRatePercent: number;
		enforce: boolean;
		enforceEnterprise: boolean;
		providers: ContentFilterProvider[];
	};
	onSave: (
		input: ContentFilterSettingsInput,
	) => Promise<{ ok: boolean; message: string | null }>;
}

export function ContentFilterSettingsForm({
	settings,
	onSave,
}: ContentFilterSettingsFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [sampleRate, setSampleRate] = useState(
		String(settings.sampleRatePercent),
	);
	const [enforce, setEnforce] = useState(settings.enforce);
	const [enforceEnterprise, setEnforceEnterprise] = useState(
		settings.enforceEnterprise,
	);
	const [providerIds, setProviderIds] = useState<string[]>(() =>
		settings.providers.filter((p) => p.enabled).map((p) => p.id),
	);
	const allSelected =
		settings.providers.length > 0 &&
		providerIds.length >= settings.providers.length;
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSaved(false);
		const rate = Number(sampleRate);
		if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
			setError("Sample rate must be between 0 and 100.");
			return;
		}
		startTransition(async () => {
			const savedEnforceEnterprise = enforce && enforceEnterprise;
			const result = await onSave({
				enabled,
				sampleRatePercent: rate,
				enforce,
				enforceEnterprise: savedEnforceEnterprise,
				providerIds,
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			setEnforceEnterprise(savedEnforceEnterprise);
			setSaved(true);
			router.refresh();
		});
	};

	return (
		<form className="flex flex-col gap-6" onSubmit={handleSubmit}>
			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-enabled"
					checked={enabled}
					disabled={pending}
					onCheckedChange={(checked) => {
						setSaved(false);
						setEnabled(checked);
					}}
				/>
				<div className="space-y-0.5">
					<Label htmlFor="content-filter-enabled">
						Moderate sampled requests
					</Label>
					<p className="text-xs text-muted-foreground">
						Master switch. Off means no moderation calls and no evaluations are
						recorded, whatever the provider list says.
					</p>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="content-filter-sample-rate">Sample rate (%)</Label>
				<Input
					id="content-filter-sample-rate"
					type="number"
					min={0}
					max={100}
					step={1}
					className="w-32"
					value={sampleRate}
					disabled={pending}
					onChange={(event) => {
						setSaved(false);
						setSampleRate(event.target.value);
					}}
				/>
				<p className="text-xs text-muted-foreground">
					Share of eligible requests sent to the moderation API. 100 moderates
					every request on an enabled provider; 0 disables moderation.
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-enforce"
					checked={enforce}
					disabled={pending}
					onCheckedChange={(checked) => {
						setSaved(false);
						setEnforce(checked);
					}}
				/>
				<div className="space-y-0.5">
					<Label htmlFor="content-filter-enforce">
						Block violating requests
					</Label>
					<p className="text-xs text-muted-foreground">
						Off records violations as metadata only. On returns the gateway
						content filter response for requests over their tier&apos;s
						thresholds. Organizations marked log-only are never blocked.
					</p>
				</div>
			</div>

			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-enforce-enterprise"
					checked={enforce && enforceEnterprise}
					disabled={pending || !enforce}
					onCheckedChange={(checked) => {
						setSaved(false);
						setEnforceEnterprise(checked);
					}}
				/>
				<div className="space-y-0.5">
					<Label htmlFor="content-filter-enforce-enterprise">
						Also block enterprise organizations
					</Label>
					<p className="text-xs text-muted-foreground">
						Enterprise organizations are sampled and logged but stay log-only
						unless this is on as well.
					</p>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-medium">Providers</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending || settings.providers.length === 0}
						onClick={() => {
							setSaved(false);
							setProviderIds(
								allSelected ? [] : settings.providers.map((p) => p.id),
							);
						}}
					>
						{allSelected ? "Unselect all" : "Select all"}
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					Only requests routed to an enabled provider are moderated.{" "}
					{providerIds.length} of {settings.providers.length} selected.
				</p>
				<MultiProviderSelector
					providers={settings.providers}
					selectedProviders={providerIds}
					onProvidersChange={(next) => {
						setSaved(false);
						setProviderIds(next);
					}}
					placeholder="Search and select providers..."
				/>
			</div>

			<div className="flex items-center gap-3">
				<Button type="submit" disabled={pending}>
					{pending ? "Saving…" : "Save"}
				</Button>
				{error && <p className="text-sm text-destructive">{error}</p>}
				{saved && !error && (
					<p className="text-sm text-muted-foreground">Saved.</p>
				)}
			</div>
		</form>
	);
}
