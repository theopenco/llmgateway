"use client";

import {
	BadgeCheck,
	Building2,
	Globe,
	Hourglass,
	ImageIcon,
	Loader2,
	ShieldCheck,
	Type,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandPreview } from "@/components/brand/BrandPreview";
import {
	changedProfileKeys,
	countryName,
	HEADQUARTERS_CODES,
	profileFieldError,
	profilePatchBody,
	profileToDraft,
	REQUIRED_PROFILE_KEYS,
} from "@/components/brand/carrier-profile";
import { useCompany } from "@/components/dashboard/company-context";
import { useInvalidateCompanies } from "@/components/dashboard/useInvalidateCompanies";
import { ProviderBrandingFields } from "@/components/ProviderBrandingFields";
import { Badge } from "@/components/ui/badge";
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
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type {
	CompanyClaim,
	ProfileDraft,
	ProfileKey,
	Soc2State,
	TriState,
} from "@/components/brand/carrier-profile";
import type { ReactNode } from "react";

const NOT_STATED = "__none";

function errorMessage(error: unknown, fallback: string) {
	return (error as { message?: string } | null)?.message ?? fallback;
}

function Section({
	icon: Icon,
	title,
	description,
	children,
	id,
}: {
	icon: typeof Type;
	title: string;
	description: ReactNode;
	children: ReactNode;
	id: string;
}) {
	return (
		<section
			aria-labelledby={`${id}-title`}
			className="border-border bg-card rounded-xl border"
		>
			<div className="flex items-start gap-3 border-b px-5 py-4">
				<span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
					<Icon className="size-4" aria-hidden />
				</span>
				<div>
					<h2 id={`${id}-title`} className="font-display font-bold">
						{title}
					</h2>
					<p className="text-muted-foreground text-xs leading-relaxed">
						{description}
					</p>
				</div>
			</div>
			<div className="space-y-5 px-5 py-5">{children}</div>
		</section>
	);
}

function FieldLabel({
	htmlFor,
	children,
	required,
}: {
	htmlFor?: string;
	children: ReactNode;
	required?: boolean;
}) {
	return (
		<Label htmlFor={htmlFor} className="flex items-center gap-1.5">
			{children}
			{required ? (
				<span className="text-primary font-mono text-[0.6rem] tracking-wider uppercase">
					Required
				</span>
			) : null}
		</Label>
	);
}

function TextField({
	field,
	label,
	placeholder,
	type = "text",
	draft,
	setField,
	hint,
	maxLength,
}: {
	field: ProfileKey;
	label: string;
	placeholder: string;
	type?: "text" | "url";
	draft: ProfileDraft;
	setField: (key: ProfileKey, value: string) => void;
	hint?: string;
	maxLength?: number;
}) {
	const id = `profile-${field}`;
	const required = (REQUIRED_PROFILE_KEYS as readonly ProfileKey[]).includes(
		field,
	);
	const error = profileFieldError(field, draft);
	const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
	return (
		<div className="space-y-1.5">
			<FieldLabel htmlFor={id} required={required}>
				{label}
			</FieldLabel>
			<Input
				id={id}
				data-testid={id}
				type={type}
				inputMode={type === "url" ? "url" : undefined}
				value={draft[field]}
				placeholder={placeholder}
				maxLength={maxLength ?? 500}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy}
				onChange={(event) => setField(field, event.target.value)}
			/>
			{error ? (
				<p id={`${id}-error`} className="text-destructive text-xs">
					{error}
				</p>
			) : hint ? (
				<p id={`${id}-hint`} className="text-muted-foreground text-xs">
					{hint}
				</p>
			) : null}
		</div>
	);
}

function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
	name,
	className,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	name: string;
	className?: string;
}) {
	return (
		<div className={cn("space-y-1.5", className)}>
			<p id={`${name}-label`} className="text-sm font-medium">
				{label}
			</p>
			<div
				role="radiogroup"
				aria-labelledby={`${name}-label`}
				className="bg-muted inline-flex rounded-md p-0.5"
			>
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={value === option.value}
						data-testid={`${name}-${option.value}`}
						onClick={() => onChange(option.value)}
						className={cn(
							"rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
							value === option.value
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

const TRI_OPTIONS: { value: TriState; label: string }[] = [
	{ value: "yes", label: "Yes" },
	{ value: "no", label: "No" },
	{ value: "unknown", label: "Not stated" },
];

const SOC2_OPTIONS: { value: Soc2State; label: string }[] = [
	{ value: "none", label: "None" },
	{ value: "type1", label: "Type I" },
	{ value: "type2", label: "Type II" },
	{ value: "unknown", label: "Not stated" },
];

function brandingBaseline(claim: CompanyClaim) {
	const pending = claim.pendingBranding;
	return {
		name: pending?.name ?? claim.providerName,
		logoUrl:
			pending && "logoUrl" in pending
				? (pending.logoUrl ?? null)
				: claim.logoUrl,
		iconUrl:
			pending && "iconUrl" in pending
				? (pending.iconUrl ?? null)
				: claim.iconUrl,
	};
}

function BrandEditor({
	claim,
	onSaved,
}: {
	claim: CompanyClaim;
	onSaved: () => void;
}) {
	const api = useApi();
	const invalidate = useInvalidateCompanies();
	const baseline = brandingBaseline(claim);
	const initialProfile = useMemo(
		() => profileToDraft(claim.profile),
		[claim.profile],
	);
	const [name, setName] = useState(baseline.name);
	const [logoUrl, setLogoUrl] = useState<string | null>(baseline.logoUrl);
	const [iconUrl, setIconUrl] = useState<string | null>(baseline.iconUrl);
	const [profile, setProfile] = useState<ProfileDraft>(initialProfile);
	const [saving, setSaving] = useState(false);

	const updateBranding = api.useMutation("patch", "/airside/claims/{id}");
	const updateProfile = api.useMutation(
		"patch",
		"/airside/claims/{id}/profile",
	);

	const trimmedName = name.trim();
	const nameChanged = trimmedName !== baseline.name;
	const logoChanged = logoUrl !== baseline.logoUrl;
	const iconChanged = iconUrl !== baseline.iconUrl;
	const brandingDirty = nameChanged || logoChanged || iconChanged;
	const profileChanges = changedProfileKeys(profile, initialProfile);
	const profileDirty = profileChanges.length > 0;
	const dirty = brandingDirty || profileDirty;
	const nameError =
		trimmedName.length < 2 ? "Use at least 2 characters." : null;
	const blockingProfileErrors = profileChanges.filter(
		(key) => profileFieldError(key, profile) !== null,
	);
	const canSave =
		dirty &&
		!saving &&
		!(nameChanged && nameError) &&
		blockingProfileErrors.length === 0;
	const isLive = claim.status === "active";

	function setField(key: ProfileKey, value: string) {
		setProfile((current) => ({ ...current, [key]: value }));
	}

	function discard() {
		setName(baseline.name);
		setLogoUrl(baseline.logoUrl);
		setIconUrl(baseline.iconUrl);
		setProfile(initialProfile);
	}

	async function save() {
		setSaving(true);
		const done: string[] = [];
		try {
			if (brandingDirty) {
				await updateBranding.mutateAsync({
					params: { path: { id: claim.id } },
					body: {
						...(nameChanged ? { name: trimmedName } : {}),
						...(logoChanged ? { logoUrl } : {}),
						...(iconChanged ? { iconUrl } : {}),
					},
				});
				done.push(isLive ? "Branding filed for review" : "Branding updated");
			}
			if (profileDirty) {
				await updateProfile.mutateAsync({
					params: { path: { id: claim.id } },
					body: profilePatchBody(profile, initialProfile),
				});
				done.push("Public profile updated");
			}
			await invalidate();
			toast.success(`${done.join(" · ")}.`);
			onSaved();
		} catch (error) {
			if (done.length > 0) {
				await invalidate();
			}
			toast.error(errorMessage(error, "Failed to save your changes"));
		} finally {
			setSaving(false);
		}
	}

	const requiredMissing = REQUIRED_PROFILE_KEYS.filter(
		(key) => !profile[key].trim(),
	);

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
			<div className="min-w-0 space-y-5">
				<div
					className="border-border bg-card flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm"
					data-testid="brand-status"
				>
					{isLive ? (
						<Badge variant="success">
							<BadgeCheck className="size-3" aria-hidden /> Live
						</Badge>
					) : (
						<Badge variant="pending">
							<Hourglass className="size-3" aria-hidden /> Claim under review
						</Badge>
					)}
					{claim.pendingBranding ? (
						<Badge variant="pending" data-testid="branding-pending-review">
							<Hourglass className="size-3" aria-hidden /> Branding pending
							review
						</Badge>
					) : null}
					<p className="text-muted-foreground basis-full text-xs leading-relaxed">
						{isLive
							? "Branding changes on a live carrier are reviewed by our team before they go public — your current name and marks stay up until then. Public profile changes apply immediately."
							: "Your claim is with our team. Edits apply as soon as the carrier goes live; public profile changes are saved immediately."}
					</p>
				</div>

				<Section
					id="identity"
					icon={Type}
					title="Identity"
					description="The display name on your provider page, model cards and the directory."
				>
					<div className="space-y-1.5">
						<FieldLabel htmlFor="brand-name" required>
							Display name
						</FieldLabel>
						<Input
							id="brand-name"
							data-testid="brand-name-input"
							value={name}
							maxLength={100}
							aria-invalid={nameError ? true : undefined}
							aria-describedby="brand-name-hint"
							onChange={(event) => setName(event.target.value)}
						/>
						<p
							id="brand-name-hint"
							className={cn(
								"text-xs",
								nameError ? "text-destructive" : "text-muted-foreground",
							)}
						>
							{nameError ?? (
								<>
									Carrier code{" "}
									<span className="font-mono">{claim.providerId}</span> stays
									the same.
								</>
							)}
						</p>
					</div>
				</Section>

				<Section
					id="assets"
					icon={ImageIcon}
					title="Logo & icon"
					description="SVG only. Single-colour marks automatically follow light and dark themes."
				>
					<ProviderBrandingFields
						logoInputId="brand-logo"
						iconInputId="brand-icon"
						providerName={name}
						logoUrl={logoUrl}
						iconUrl={iconUrl}
						onLogoChange={setLogoUrl}
						onIconChange={setIconUrl}
					/>
				</Section>

				<Section
					id="profile"
					icon={Globe}
					title="Public profile"
					description="Self-declared details shown on your public provider page. Changes apply immediately."
				>
					{requiredMissing.length > 0 ? (
						<p
							className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs"
							role="note"
						>
							Your website, privacy policy and terms of use are required on
							every public carrier page.
						</p>
					) : null}
					<div className="grid gap-4 sm:grid-cols-2">
						<TextField
							field="website"
							label="Website"
							type="url"
							placeholder="https://acme.ai"
							draft={profile}
							setField={setField}
						/>
						<TextField
							field="statusPageUrl"
							label="Status page"
							type="url"
							placeholder="https://status.acme.ai"
							draft={profile}
							setField={setField}
						/>
						<TextField
							field="privacyPolicyUrl"
							label="Privacy policy URL"
							type="url"
							placeholder="https://acme.ai/privacy"
							draft={profile}
							setField={setField}
						/>
						<TextField
							field="termsUrl"
							label="Terms of use URL"
							type="url"
							placeholder="https://acme.ai/terms"
							draft={profile}
							setField={setField}
						/>
					</div>

					<div className="border-border grid gap-4 border-t pt-5 sm:grid-cols-2">
						<p className="text-muted-foreground flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.2em] uppercase sm:col-span-2">
							<Building2 className="size-3.5" aria-hidden /> Company
						</p>
						<TextField
							field="legalEntity"
							label="Legal entity"
							placeholder="Acme AI, Inc."
							draft={profile}
							setField={setField}
							maxLength={200}
						/>
						<div className="space-y-1.5">
							<FieldLabel htmlFor="profile-headquarters">
								Headquarters
							</FieldLabel>
							<Select
								value={profile.headquarters || NOT_STATED}
								onValueChange={(value) =>
									setField("headquarters", value === NOT_STATED ? "" : value)
								}
							>
								<SelectTrigger
									id="profile-headquarters"
									className="w-full"
									data-testid="profile-headquarters"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NOT_STATED}>Not stated</SelectItem>
									{Array.from(
										new Set<string>([
											...HEADQUARTERS_CODES,
											...(profile.headquarters ? [profile.headquarters] : []),
										]),
									)
										.map((code) => ({ code, name: countryName(code) }))
										.sort((a, b) => a.name.localeCompare(b.name))
										.map(({ code, name: country }) => (
											<SelectItem key={code} value={code}>
												{country}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="border-border grid gap-4 border-t pt-5 sm:grid-cols-2">
						<p className="text-muted-foreground flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.2em] uppercase sm:col-span-2">
							<ShieldCheck className="size-3.5" aria-hidden /> Data policy
						</p>
						<Segmented
							name="profile-apiTraining"
							label="Trains on API data"
							value={profile.apiTraining}
							options={TRI_OPTIONS}
							onChange={(value) => setField("apiTraining", value)}
						/>
						<Segmented
							name="profile-promptLogging"
							label="Logs prompts"
							value={profile.promptLogging}
							options={TRI_OPTIONS}
							onChange={(value) => setField("promptLogging", value)}
						/>
						<TextField
							field="retentionPeriod"
							label="Retention"
							placeholder="30 days"
							draft={profile}
							setField={setField}
							maxLength={100}
							hint="How long prompts and completions are kept, if at all."
						/>
						<Segmented
							name="profile-gdpr"
							label="GDPR compliant"
							value={profile.gdpr}
							options={TRI_OPTIONS}
							onChange={(value) => setField("gdpr", value)}
						/>
						<Segmented
							name="profile-iso27001"
							label="ISO 27001 certified"
							value={profile.iso27001}
							options={TRI_OPTIONS}
							onChange={(value) => setField("iso27001", value)}
						/>
						<Segmented
							name="profile-soc2"
							label="SOC 2"
							value={profile.soc2}
							options={SOC2_OPTIONS}
							onChange={(value) => setField("soc2", value)}
							className="sm:col-span-2"
						/>
					</div>
				</Section>

				{dirty ? (
					<div
						className="border-primary/40 bg-background/95 supports-backdrop-filter:bg-background/80 sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur"
						role="region"
						aria-label="Unsaved changes"
					>
						<div className="min-w-0 text-sm">
							<p className="font-semibold">Unsaved changes</p>
							<p className="text-muted-foreground text-xs">
								{[
									brandingDirty
										? isLive
											? "Branding goes to review"
											: "Branding updates"
										: null,
									profileDirty ? "Profile applies immediately" : null,
								]
									.filter(Boolean)
									.join(" · ")}
								{blockingProfileErrors.length > 0
									? " · fix the highlighted fields first"
									: ""}
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="ghost"
								disabled={saving}
								onClick={discard}
								data-testid="brand-discard"
							>
								Discard
							</Button>
							<Button
								type="button"
								className="font-semibold"
								disabled={!canSave}
								onClick={() => void save()}
								data-testid="brand-save"
							>
								{saving ? (
									<Loader2 className="size-4 animate-spin" aria-hidden />
								) : null}
								{saving ? "Saving…" : "Save changes"}
							</Button>
						</div>
					</div>
				) : null}
			</div>

			<div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
				<BrandPreview
					providerId={claim.providerId}
					name={name}
					logoUrl={logoUrl}
					iconUrl={iconUrl}
					profile={profile}
				/>
				<p className="text-muted-foreground mt-2 text-xs">
					Updates as you type — nothing is public until you save
					{isLive && brandingDirty ? " and branding passes review" : ""}.
				</p>
			</div>
		</div>
	);
}

function BrandContent() {
	const { company, isLoading } = useCompany();
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const [version, setVersion] = useState(0);

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	const claims = (company?.claims ?? []).filter(
		(claim) => claim.status === "active" || claim.status === "pending",
	);

	if (!company || claims.length === 0) {
		return (
			<div className="space-y-3 py-20 text-center" data-testid="brand-page">
				<h1 className="font-display text-2xl font-black">Brand & profile</h1>
				<p className="text-muted-foreground text-sm">
					Claim or register a carrier first —{" "}
					<Link href="/onboarding" className="text-primary hover:underline">
						go to onboarding
					</Link>
					.
				</p>
			</div>
		);
	}

	const requested = searchParams.get("carrier");
	const claim =
		claims.find((candidate) => candidate.providerId === requested) ?? claims[0];

	return (
		<div className="space-y-6" data-testid="brand-page">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Brand & profile
					</p>
					<h1 className="font-display text-3xl font-black tracking-tight">
						How developers see {brandingBaseline(claim).name}
					</h1>
					<p className="text-muted-foreground mt-1 max-w-xl text-sm">
						Edit your name, logo and public profile — the preview shows your
						provider page, model cards and directory listing as you type.
					</p>
				</div>
				{claims.length > 1 ? (
					<div className="w-full space-y-1.5 sm:w-64">
						<Label htmlFor="brand-carrier">Carrier</Label>
						<Select
							value={claim.providerId}
							onValueChange={(providerId) =>
								router.replace(
									`${pathname}?carrier=${encodeURIComponent(providerId)}`,
									{ scroll: false },
								)
							}
						>
							<SelectTrigger
								id="brand-carrier"
								className="w-full"
								data-testid="brand-carrier-select"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{claims.map((candidate) => (
									<SelectItem key={candidate.id} value={candidate.providerId}>
										{candidate.providerName}
										{candidate.profileMissing.length > 0
											? " · needs links"
											: ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : null}
			</div>
			<BrandEditor
				key={`${claim.id}:${version}`}
				claim={claim}
				onSaved={() => setVersion((current) => current + 1)}
			/>
		</div>
	);
}

export default function BrandPage() {
	return (
		<Suspense>
			<BrandContent />
		</Suspense>
	);
}
