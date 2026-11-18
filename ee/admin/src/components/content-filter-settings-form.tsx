"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

import { MultiProviderSelector } from "@llmgateway/shared/components";

import type { ContentFilterSettingsInput } from "@/lib/admin-settings";

interface ContentFilterProvider {
	id: string;
	name: string;
	color: string | null;
	enabled: boolean;
	enforced: boolean;
}

type Classifier = ContentFilterSettingsInput["classifier"];

const CLASSIFIER_LABELS: Record<Classifier, string> = {
	openai: "OpenAI moderation",
	jev: "Jev (TypeSafe)",
	internal: "Internal classifier",
};

type BlockGroup = NonNullable<
	ContentFilterSettingsInput["blockGroups"]
>[number];

const BLOCK_GROUP_LABELS: Record<BlockGroup, string> = {
	csam: "Child safety (CSAM)",
	sexual: "Sexual content",
	cyber: "Cyber abuse",
};

type InternalScope = ContentFilterSettingsInput["internalScope"];

const INTERNAL_SCOPE_LABELS: Record<InternalScope, string> = {
	full: "Whole conversation",
	latest_turn: "Latest turn only",
};

interface ContentFilterSettingsFormProps {
	settings: {
		enabled: boolean;
		sampleRatePercent: number;
		enforce: boolean;
		enforceSampleRatePercent: number;
		enforceEnterprise: boolean;
		classifier: Classifier;
		shadowClassifiers: Classifier[];
		internalScope: InternalScope;
		moderateImages: boolean;
		blockGroups: BlockGroup[] | null;
		csamScoreThreshold: number;
		preserveFlaggedPayloads: boolean;
		providers: ContentFilterProvider[];
	};
}

export function ContentFilterSettingsForm({
	settings,
}: ContentFilterSettingsFormProps) {
	const router = useRouter();
	const readOnly = !canWrite(useAdminRole());
	const $api = useApi();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [sampleRate, setSampleRate] = useState(
		String(settings.sampleRatePercent),
	);
	const [enforce, setEnforce] = useState(settings.enforce);
	const [enforceEnterprise, setEnforceEnterprise] = useState(
		settings.enforceEnterprise,
	);
	const [classifier, setClassifier] = useState<Classifier>(settings.classifier);
	const [shadowClassifiers, setShadowClassifiers] = useState<Classifier[]>(
		settings.shadowClassifiers,
	);
	// The deciding classifier never shadows itself.
	const activeShadows = shadowClassifiers.filter(
		(option) => option !== classifier,
	);
	const runsInternal =
		classifier === "internal" || activeShadows.includes("internal");
	const runsTextOnly =
		classifier !== "openai" || activeShadows.some((c) => c !== "openai");
	const [internalScope, setInternalScope] = useState<InternalScope>(
		settings.internalScope,
	);
	const [moderateImages, setModerateImages] = useState(settings.moderateImages);
	const [limitGroups, setLimitGroups] = useState(settings.blockGroups !== null);
	const [blockGroups, setBlockGroups] = useState<BlockGroup[]>(
		settings.blockGroups ?? [],
	);
	const [csamThreshold, setCsamThreshold] = useState(
		String(settings.csamScoreThreshold),
	);
	const [preserveFlaggedPayloads, setPreserveFlaggedPayloads] = useState(
		settings.preserveFlaggedPayloads,
	);
	const [providerIds, setProviderIds] = useState<string[]>(() =>
		settings.providers.filter((p) => p.enabled).map((p) => p.id),
	);
	const [enforceProviderIds, setEnforceProviderIds] = useState<string[]>(() =>
		settings.providers.filter((p) => p.enforced).map((p) => p.id),
	);
	const [enforceSampleRate, setEnforceSampleRate] = useState(
		String(settings.enforceSampleRatePercent),
	);
	const anyEnforced = enforce || enforceProviderIds.length > 0;
	const allSelected =
		settings.providers.length > 0 &&
		providerIds.length >= settings.providers.length;
	// Client-side validation; API failures come from the mutation.
	const [validationError, setValidationError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const mutation = $api.useMutation("put", "/admin/settings/content-filter", {
		meta: { inlineError: true },
	});
	const pending = mutation.isPending;
	const error =
		validationError ??
		(mutation.isError
			? apiErrorMessage(
					mutation.error,
					"Failed to update the content filter settings.",
				)
			: null);

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setValidationError(null);
		setSaved(false);
		const rate = Number(sampleRate);
		if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
			mutation.reset();
			setValidationError("Sample rate must be between 0 and 100.");
			return;
		}
		const editedEnforceRate = Number(enforceSampleRate);
		const enforceRateValid =
			enforceSampleRate.trim() !== "" &&
			Number.isFinite(editedEnforceRate) &&
			editedEnforceRate >= 0 &&
			editedEnforceRate <= 100;
		// The field is disabled while global blocking is on, so an invalid edit
		// keeps the stored value instead of failing validation.
		if (!enforceRateValid && !enforce) {
			mutation.reset();
			setValidationError("Blocking sample rate must be between 0 and 100.");
			return;
		}
		const enforceRate = enforceRateValid
			? editedEnforceRate
			: settings.enforceSampleRatePercent;
		if (!enforceRateValid) {
			setEnforceSampleRate(String(enforceRate));
		}
		const csamScoreThreshold = Number(csamThreshold);
		if (
			csamThreshold.trim() === "" ||
			!Number.isFinite(csamScoreThreshold) ||
			csamScoreThreshold < 0 ||
			csamScoreThreshold > 1
		) {
			mutation.reset();
			setValidationError("CSAM score threshold must be between 0 and 1.");
			return;
		}
		const savedEnforceEnterprise = anyEnforced && enforceEnterprise;
		mutation.mutate(
			{
				body: {
					enabled,
					sampleRatePercent: rate,
					enforce,
					enforceProviderIds,
					enforceSampleRatePercent: enforceRate,
					enforceEnterprise: savedEnforceEnterprise,
					classifier,
					shadowClassifiers: activeShadows,
					internalScope,
					moderateImages,
					blockGroups: limitGroups ? blockGroups : null,
					csamScoreThreshold,
					preserveFlaggedPayloads,
					providerIds,
				},
			},
			{
				onSuccess: () => {
					setEnforceEnterprise(savedEnforceEnterprise);
					setSaved(true);
					router.refresh();
				},
			},
		);
	};

	return (
		<form className="flex flex-col gap-6" onSubmit={handleSubmit}>
			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-enabled"
					checked={enabled}
					disabled={pending || readOnly}
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
					disabled={pending || readOnly}
					onChange={(event) => {
						setSaved(false);
						setSampleRate(event.target.value);
					}}
				/>
				<p className="text-xs text-muted-foreground">
					Share of eligible requests sent to the moderation API. 100 moderates
					every request on an enabled provider; 0 disables moderation, except
					the blocking share of blocking providers while blocking is off for
					everyone.
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-enforce"
					checked={enforce}
					disabled={pending || readOnly}
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
						Requests that cannot be blocked are classified in the background and
						add no latency; only blocking checks run before the provider call.
					</p>
				</div>
			</div>

			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-enforce-enterprise"
					checked={anyEnforced && enforceEnterprise}
					disabled={pending || readOnly || !anyEnforced}
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

			<div className="space-y-3">
				<div className="flex items-center gap-3">
					<Switch
						id="content-filter-limit-groups"
						checked={limitGroups}
						disabled={pending || readOnly}
						onCheckedChange={(checked) => {
							setSaved(false);
							setLimitGroups(checked);
						}}
					/>
					<div className="space-y-0.5">
						<Label htmlFor="content-filter-limit-groups">
							Block only selected groups
						</Label>
						<p className="text-xs text-muted-foreground">
							Off blocks every violation. On blocks only violations in the
							groups below and logs the rest. Groups cover both OpenAI
							categories and the internal classifier&apos;s rules.
						</p>
					</div>
				</div>
				{limitGroups ? (
					<div className="flex flex-wrap gap-4 pl-12">
						{(Object.keys(BLOCK_GROUP_LABELS) as BlockGroup[]).map((group) => (
							<label key={group} className="flex items-center gap-2 text-sm">
								<Checkbox
									checked={blockGroups.includes(group)}
									disabled={pending || readOnly}
									onCheckedChange={(checked) => {
										setSaved(false);
										setBlockGroups((current) =>
											checked === true
												? [...current.filter((g) => g !== group), group]
												: current.filter((g) => g !== group),
										);
									}}
								/>
								{BLOCK_GROUP_LABELS[group]}
							</label>
						))}
					</div>
				) : null}
			</div>

			<div className="space-y-2">
				<Label htmlFor="content-filter-csam-threshold">
					CSAM score threshold
				</Label>
				<Input
					id="content-filter-csam-threshold"
					className="w-32"
					inputMode="decimal"
					value={csamThreshold}
					disabled={pending || readOnly}
					onChange={(event) => {
						setSaved(false);
						setCsamThreshold(event.target.value);
					}}
				/>
				<p className="text-xs text-muted-foreground">
					OpenAI &quot;sexual/minors&quot; score above which a request is a
					child-safety violation at every tier, independent of the tier
					thresholds.
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Switch
					id="content-filter-preserve-flagged"
					checked={preserveFlaggedPayloads}
					disabled={pending || readOnly}
					onCheckedChange={(checked) => {
						setSaved(false);
						setPreserveFlaggedPayloads(checked);
					}}
				/>
				<div className="space-y-0.5">
					<Label htmlFor="content-filter-preserve-flagged">
						Preserve flagged payloads
					</Label>
					<p className="text-xs text-muted-foreground">
						Keeps an encrypted copy of requests the deciding classifier flags
						for child safety or sexual content, for every organization and
						whether or not they are blocked, for 90 days (one year after an
						NCMEC report). Only child safety is kept under zero data retention.{" "}
						<Link href="/content-filter/flagged-payloads" className="underline">
							Review flagged payloads
						</Link>
						.
					</p>
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="content-filter-classifier">Classifier</Label>
				<Select
					value={classifier}
					disabled={pending || readOnly}
					onValueChange={(value) => {
						setSaved(false);
						setClassifier(value as Classifier);
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
					Model that scores sampled requests and decides the outcome. Jev and
					the internal classifier are text-only. The internal classifier runs in
					our own infrastructure and blocks only on its own verdict; its topic
					tags are recorded, never enforced. Thresholds are per classifier, so
					re-measure before switching an enforcing filter.
				</p>
			</div>

			<div className="space-y-2">
				<p className="text-sm font-medium">Shadow classifiers</p>
				<div className="flex flex-wrap gap-4">
					{(Object.keys(CLASSIFIER_LABELS) as Classifier[])
						.filter((option) => option !== classifier)
						.map((option) => (
							<div key={option} className="flex items-center gap-2">
								<Checkbox
									id={`content-filter-shadow-${option}`}
									checked={activeShadows.includes(option)}
									disabled={pending || readOnly}
									onCheckedChange={(checked) => {
										setSaved(false);
										setShadowClassifiers((current) =>
											checked === true
												? [...current.filter((c) => c !== option), option]
												: current.filter((c) => c !== option),
										);
									}}
								/>
								<Label htmlFor={`content-filter-shadow-${option}`}>
									{CLASSIFIER_LABELS[option]}
								</Label>
							</div>
						))}
				</div>
				<p className="text-xs text-muted-foreground">
					Also score every sampled request with these classifiers, in the
					background and in parallel with the deciding one. Their verdicts are
					recorded and never block or delay a request. Each runs with the same
					tier, input scope and image setting it would use if it decided, so its
					flag rate compares with any other run of it on the{" "}
					<Link href="/content-filter/classifiers" className="underline">
						classifier comparison
					</Link>
					.
				</p>
			</div>

			{runsInternal && (
				<div className="space-y-2">
					<Label htmlFor="content-filter-internal-scope">
						Internal classifier input
					</Label>
					<Select
						value={internalScope}
						disabled={pending || readOnly}
						onValueChange={(value) => {
							setSaved(false);
							setInternalScope(value as InternalScope);
						}}
					>
						<SelectTrigger id="content-filter-internal-scope" className="w-64">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(INTERNAL_SCOPE_LABELS) as InternalScope[]).map(
								(option) => (
									<SelectItem key={option} value={option}>
										{INTERNAL_SCOPE_LABELS[option]}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						Whole conversation classifies every message, in as many requests as
						its size needs; long agent histories can take seconds, which only
						delays requests when blocking is on. Latest turn only sends the
						system prompt plus the messages after the last assistant reply, in
						one request.
					</p>
				</div>
			)}

			{runsTextOnly && (
				<div className="flex items-center gap-3">
					<Switch
						id="content-filter-moderate-images"
						checked={moderateImages}
						disabled={pending || readOnly}
						onCheckedChange={(checked) => {
							setSaved(false);
							setModerateImages(checked);
						}}
					/>
					<div className="space-y-0.5">
						<Label htmlFor="content-filter-moderate-images">
							Moderate images with OpenAI
						</Label>
						<p className="text-xs text-muted-foreground">
							Jev and the internal classifier are text-only. On sends image
							parts to OpenAI moderation and merges the verdicts, for the
							deciding and shadow classifiers alike; off moderates text only and
							leaves images unchecked.
						</p>
					</div>
				</div>
			)}

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-medium">Providers</p>
					{!readOnly && (
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
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					Only requests routed to an enabled provider are moderated.{" "}
					{providerIds.length} of {settings.providers.length} selected.
				</p>
				{readOnly ? (
					<div className="flex flex-wrap gap-2">
						{settings.providers
							.filter((p) => p.enabled)
							.map((p) => (
								<Badge key={p.id} variant="secondary">
									{p.name}
								</Badge>
							))}
					</div>
				) : (
					<MultiProviderSelector
						providers={settings.providers}
						selectedProviders={providerIds}
						onProvidersChange={(next) => {
							setSaved(false);
							setProviderIds(next);
						}}
						placeholder="Search and select providers..."
					/>
				)}
			</div>

			<div className="space-y-2">
				<p className="text-sm font-medium">Blocking providers</p>
				<p className="text-xs text-muted-foreground">
					A share of requests routed to these providers, set by the blocking
					sample rate, is checked before the provider call and blocked on a
					violation, even while blocking is off for everyone else. The rest are
					monitored log-only at the sample rate above. These providers do not
					need to be in the provider list. The enterprise and log-only
					organization exemptions still apply.
				</p>
				{readOnly ? (
					<div className="flex flex-wrap gap-2">
						{settings.providers
							.filter((p) => p.enforced)
							.map((p) => (
								<Badge key={p.id} variant="secondary">
									{p.name}
								</Badge>
							))}
					</div>
				) : (
					<MultiProviderSelector
						providers={settings.providers}
						selectedProviders={enforceProviderIds}
						onProvidersChange={(next) => {
							setSaved(false);
							setEnforceProviderIds(next);
						}}
						placeholder="Search and select blocking providers..."
					/>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="content-filter-enforce-sample-rate">
					Blocking sample rate (%)
				</Label>
				<Input
					id="content-filter-enforce-sample-rate"
					type="number"
					min={0}
					max={100}
					step="any"
					className="w-32"
					value={enforceSampleRate}
					disabled={pending || readOnly || enforce}
					onChange={(event) => {
						setSaved(false);
						setEnforceSampleRate(event.target.value);
					}}
				/>
				<p className="text-xs text-muted-foreground">
					Share of a blocking provider&apos;s requests checked in blocking mode.
					Ignored while blocking is on for everyone.
				</p>
			</div>

			<div className="flex items-center gap-3">
				{!readOnly && (
					<Button type="submit" disabled={pending}>
						{pending ? "Saving…" : "Save"}
					</Button>
				)}
				{error && <p className="text-sm text-destructive">{error}</p>}
				{saved && !error && (
					<p className="text-sm text-muted-foreground">Saved.</p>
				)}
			</div>
		</form>
	);
}
