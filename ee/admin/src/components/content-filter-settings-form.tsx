"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { MultiProviderSelector } from "@llmgateway/shared/components";

import type { ContentFilterSettingsInput } from "@/lib/admin-settings";

interface ContentFilterProvider {
	id: string;
	name: string;
	color: string | null;
	enabled: boolean;
}

type Classifier = ContentFilterSettingsInput["classifier"];
type ShadowClassifier = ContentFilterSettingsInput["shadowClassifier"];

const CLASSIFIER_LABELS: Record<Classifier, string> = {
	openai: "OpenAI moderation",
	jev: "Jev (TypeSafe)",
};

interface ContentFilterSettingsFormProps {
	settings: {
		enabled: boolean;
		sampleRatePercent: number;
		enforce: boolean;
		enforceEnterprise: boolean;
		classifier: Classifier;
		shadowClassifier: ShadowClassifier;
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
	const [classifier, setClassifier] = useState<Classifier>(settings.classifier);
	const [shadowClassifier, setShadowClassifier] = useState<ShadowClassifier>(
		settings.shadowClassifier,
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
				classifier,
				shadowClassifier,
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
				<Label htmlFor="content-filter-classifier">Classifier</Label>
				<Select
					value={classifier}
					disabled={pending}
					onValueChange={(value) => {
						setSaved(false);
						setClassifier(value as Classifier);
						// A classifier never shadows itself.
						if (shadowClassifier === value) {
							setShadowClassifier("none");
						}
					}}
				>
					<SelectTrigger id="content-filter-classifier" className="w-64">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(Object.keys(CLASSIFIER_LABELS) as Classifier[]).map((option) => (
							<SelectItem key={option} value={option}>
								{CLASSIFIER_LABELS[option]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					Model that scores sampled requests and decides the outcome. Jev is
					text-only: image parts are still moderated by OpenAI. Thresholds are
					per classifier, so re-measure before switching an enforcing filter.
				</p>
			</div>

			<div className="space-y-2">
				<Label htmlFor="content-filter-shadow-classifier">
					Shadow classifier
				</Label>
				<Select
					value={shadowClassifier}
					disabled={pending}
					onValueChange={(value) => {
						setSaved(false);
						setShadowClassifier(value as ShadowClassifier);
					}}
				>
					<SelectTrigger id="content-filter-shadow-classifier" className="w-64">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">None</SelectItem>
						{(Object.keys(CLASSIFIER_LABELS) as Classifier[])
							.filter((option) => option !== classifier)
							.map((option) => (
								<SelectItem key={option} value={option}>
									{CLASSIFIER_LABELS[option]}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					Runs on the same sampled requests for comparison and is recorded on
					the request log, including whether it disagreed. It never blocks, and
					it doubles the moderation cost of a sampled request.
				</p>
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
