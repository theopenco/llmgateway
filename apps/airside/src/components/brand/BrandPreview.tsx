"use client";

import {
	ArrowRight,
	Clock,
	Database,
	ExternalLink,
	Eye,
	MapPin,
	Moon,
	ShieldAlert,
	ShieldCheck,
	Sun,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { CarrierMark } from "@llmgateway/shared/carrier-mark";

import { countryName, draftToPublicPolicy, isHttpUrl } from "./carrier-profile";

import type { ProfileDraft } from "./carrier-profile";

type PreviewTheme = "light" | "dark";
type PreviewTab = "provider" | "model" | "directory";

const TABS: { id: PreviewTab; label: string }[] = [
	{ id: "provider", label: "Provider page" },
	{ id: "model", label: "Model card" },
	{ id: "directory", label: "Directory card" },
];

const PALETTES = {
	light: {
		surface: "bg-white text-slate-950",
		card: "border-slate-200 bg-slate-50",
		muted: "text-slate-500",
		chip: "bg-slate-100 text-slate-600",
		primaryButton: "bg-slate-950 text-white",
		outlineButton: "border-slate-300 text-slate-900",
		divider: "border-slate-200",
		good: "bg-green-500/10 text-green-700",
		bad: "bg-red-500/10 text-red-700",
		missing: "border-red-300 text-red-600",
	},
	dark: {
		surface: "bg-slate-950 text-slate-50",
		card: "border-slate-800 bg-slate-900",
		muted: "text-slate-400",
		chip: "bg-slate-800 text-slate-300",
		primaryButton: "bg-white text-slate-950",
		outlineButton: "border-slate-700 text-slate-100",
		divider: "border-slate-800",
		good: "bg-green-500/15 text-green-400",
		bad: "bg-red-500/15 text-red-400",
		missing: "border-red-500/50 text-red-400",
	},
} as const;

type Palette = (typeof PALETTES)[PreviewTheme];

export interface BrandPreviewProps {
	providerId: string;
	name: string;
	logoUrl: string | null;
	iconUrl: string | null;
	profile: ProfileDraft;
}

function Mark({
	src,
	name,
	className,
	fallbackClassName,
}: {
	src: string | null;
	name: string;
	className: string;
	fallbackClassName?: string;
}) {
	if (src) {
		return <CarrierMark src={src} alt={`${name} mark`} className={className} />;
	}
	return (
		<span
			aria-hidden
			className={cn(
				"flex items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-orange-600 font-black text-white uppercase",
				fallbackClassName ?? className,
			)}
		>
			{name.trim().charAt(0) || "?"}
		</span>
	);
}

function PolicyBadge({
	value,
	palette,
	labelTrue = "Yes",
	labelFalse = "No",
	dangerIfTrue = false,
}: {
	value: boolean | null;
	palette: Palette;
	labelTrue?: string;
	labelFalse?: string;
	dangerIfTrue?: boolean;
}) {
	if (value === null) {
		return (
			<span className={cn("rounded-md px-2 py-0.5 text-[11px]", palette.chip)}>
				Unknown
			</span>
		);
	}
	const danger = dangerIfTrue ? value : !value;
	return (
		<span
			className={cn(
				"rounded-md px-2 py-0.5 text-[11px]",
				danger ? palette.bad : palette.good,
			)}
		>
			{value ? labelTrue : labelFalse}
		</span>
	);
}

function ProviderPagePreview({
	name,
	logoUrl,
	iconUrl,
	profile,
	palette,
}: BrandPreviewProps & { palette: Palette }) {
	const policy = draftToPublicPolicy(profile);
	const links = [
		{ label: "Status Page", href: profile.statusPageUrl, required: false },
		{ label: "Terms of Service", href: profile.termsUrl, required: true },
		{ label: "Privacy Policy", href: profile.privacyPolicyUrl, required: true },
	];
	const website = isHttpUrl(profile.website) ? profile.website : null;

	return (
		<div className="space-y-4 p-5">
			<div className="flex h-14 items-center">
				<Mark
					src={logoUrl ?? iconUrl}
					name={name}
					className={logoUrl ? "h-12 w-40 object-contain" : "size-12"}
					fallbackClassName="size-12 text-xl"
				/>
			</div>
			<div>
				<h3 className="text-2xl font-bold tracking-tight">{name} API</h3>
				<p className={cn("mt-2 text-sm leading-relaxed", palette.muted)}>
					Access {name} models through one OpenAI-compatible API, with smart
					routing, fallbacks and unified billing on LLM Gateway.
				</p>
			</div>
			<div className="flex flex-wrap gap-2 text-xs font-medium">
				<span className={cn("rounded-md px-3 py-1.5", palette.primaryButton)}>
					Get started
				</span>
				<span
					className={cn(
						"rounded-md border px-3 py-1.5",
						website
							? palette.outlineButton
							: cn("border-dashed", palette.missing),
					)}
				>
					{website ? "Visit website" : "Visit website · add a URL"}
				</span>
			</div>
			<div className={cn("rounded-lg border p-3", palette.card)}>
				<p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
					{policy.apiTraining === false ? (
						<ShieldCheck className="size-3.5 text-green-500" />
					) : (
						<ShieldAlert className={cn("size-3.5", palette.muted)} />
					)}
					Data & Privacy
				</p>
				<div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
					{profile.headquarters ? (
						<div className="flex items-center gap-1.5">
							<MapPin className={cn("size-3", palette.muted)} />
							<span className={palette.muted}>HQ:</span>
							<span className="font-medium">
								{countryName(profile.headquarters)}
							</span>
						</div>
					) : null}
					<div className="flex items-center gap-1.5">
						<Database className={cn("size-3", palette.muted)} />
						<span className={palette.muted}>API Training:</span>
						<PolicyBadge
							value={policy.apiTraining}
							palette={palette}
							dangerIfTrue
						/>
					</div>
					<div className="flex items-center gap-1.5">
						<Eye className={cn("size-3", palette.muted)} />
						<span className={palette.muted}>Prompt Logging:</span>
						<PolicyBadge
							value={policy.promptLogging}
							palette={palette}
							dangerIfTrue
						/>
					</div>
					<div className="flex items-center gap-1.5">
						<Clock className={cn("size-3", palette.muted)} />
						<span className={palette.muted}>Retention:</span>
						<span className="font-medium">
							{policy.retentionPeriod ?? "Unknown"}
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<ShieldCheck className={cn("size-3", palette.muted)} />
						<span className={palette.muted}>GDPR:</span>
						<PolicyBadge
							value={policy.gdpr}
							palette={palette}
							labelTrue="Compliant"
						/>
					</div>
					<div className="flex items-center gap-1.5">
						<ShieldCheck className={cn("size-3", palette.muted)} />
						<span className={palette.muted}>SOC 2:</span>
						{policy.soc2 === null ? (
							<PolicyBadge value={null} palette={palette} />
						) : (
							<PolicyBadge
								value={policy.soc2 > 0}
								palette={palette}
								labelTrue={policy.soc2 === 2 ? "Type II" : "Type I"}
							/>
						)}
					</div>
					<div className="flex items-center gap-1.5">
						<ShieldCheck className={cn("size-3", palette.muted)} />
						<span className={palette.muted}>ISO 27001:</span>
						<PolicyBadge
							value={policy.iso27001}
							palette={palette}
							labelTrue="Certified"
						/>
					</div>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
				{links.map((link) =>
					isHttpUrl(link.href) ? (
						<span
							key={link.label}
							className={cn("inline-flex items-center gap-1", palette.muted)}
						>
							{link.label}
							<ExternalLink className="size-3" />
						</span>
					) : link.required ? (
						<span
							key={link.label}
							className={cn(
								"rounded border border-dashed px-1.5 py-0.5",
								palette.missing,
							)}
						>
							{link.label} missing
						</span>
					) : null,
				)}
			</div>
		</div>
	);
}

function ModelCardPreview({
	providerId,
	name,
	iconUrl,
	logoUrl,
	palette,
}: BrandPreviewProps & { palette: Palette }) {
	return (
		<div className="p-5">
			<div className={cn("rounded-xl border p-4", palette.card)}>
				<div className="flex items-center gap-2">
					<Mark
						src={iconUrl ?? logoUrl}
						name={name}
						className="size-5 object-contain"
						fallbackClassName="size-5 text-[10px]"
					/>
					<span className="truncate text-sm font-semibold">{name}</span>
				</div>
				<p className="mt-3 text-base font-semibold">{name} Large</p>
				<p className={cn("font-mono text-xs", palette.muted)}>
					{providerId}/{providerId}-large
				</p>
				<div
					className={cn(
						"mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-xs",
						palette.divider,
					)}
				>
					<div>
						<p className={palette.muted}>Input</p>
						<p className="font-mono font-medium">$0.50/M</p>
					</div>
					<div>
						<p className={palette.muted}>Output</p>
						<p className="font-mono font-medium">$1.50/M</p>
					</div>
					<div>
						<p className={palette.muted}>Context</p>
						<p className="font-mono font-medium">128K</p>
					</div>
				</div>
			</div>
			<p className={cn("mt-3 text-xs", palette.muted)}>
				Sample model row — your square icon sits beside the provider name.
			</p>
		</div>
	);
}

function DirectoryCardPreview({
	name,
	logoUrl,
	iconUrl,
	palette,
}: BrandPreviewProps & { palette: Palette }) {
	return (
		<div className="p-5">
			<div
				className={cn(
					"flex items-center gap-4 rounded-xl border p-4",
					palette.card,
				)}
			>
				<div className="flex h-12 w-16 shrink-0 items-center justify-center">
					<Mark
						src={logoUrl ?? iconUrl}
						name={name}
						className="h-12 w-16 object-contain"
						fallbackClassName="size-12 text-xl"
					/>
				</div>
				<div className="min-w-0">
					<p className="truncate font-semibold">{name}</p>
					<p className={cn("flex items-center gap-1 text-xs", palette.muted)}>
						View models <ArrowRight className="size-3" />
					</p>
				</div>
			</div>
		</div>
	);
}

export function BrandPreview(props: BrandPreviewProps) {
	const [theme, setTheme] = useState<PreviewTheme>("light");
	const [tab, setTab] = useState<PreviewTab>("provider");
	const palette = PALETTES[theme];
	const name = props.name.trim() || "Your provider";
	const previewProps = { ...props, name, palette };

	return (
		<section
			className="border-border bg-card overflow-hidden rounded-xl border"
			aria-label="Live preview"
			data-testid="brand-preview"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
				<p className="text-muted-foreground flex items-center gap-2 font-mono text-[0.65rem] tracking-[0.2em] uppercase">
					<span className="relative flex size-2">
						<span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" />
						<span className="bg-primary relative inline-flex size-2 rounded-full" />
					</span>
					Live preview
				</p>
				<div
					role="group"
					aria-label="Preview theme"
					className="bg-muted flex rounded-md p-0.5"
				>
					{(
						[
							{ id: "light", label: "Light", Icon: Sun },
							{ id: "dark", label: "Dark", Icon: Moon },
						] as const
					).map(({ id, label, Icon }) => (
						<button
							key={id}
							type="button"
							aria-pressed={theme === id}
							onClick={() => setTheme(id)}
							className={cn(
								"flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
								theme === id
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="size-3" aria-hidden />
							{label}
						</button>
					))}
				</div>
			</div>
			<div
				role="tablist"
				aria-label="Preview surface"
				className="flex gap-1 overflow-x-auto border-b px-3"
			>
				{TABS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						role="tab"
						id={`brand-preview-tab-${entry.id}`}
						aria-selected={tab === entry.id}
						aria-controls="brand-preview-panel"
						onClick={() => setTab(entry.id)}
						className={cn(
							"-mb-px border-b-2 px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors",
							tab === entry.id
								? "border-primary text-foreground"
								: "text-muted-foreground hover:text-foreground border-transparent",
						)}
					>
						{entry.label}
					</button>
				))}
			</div>
			<div
				id="brand-preview-panel"
				role="tabpanel"
				aria-labelledby={`brand-preview-tab-${tab}`}
				className={cn("transition-colors", palette.surface)}
			>
				{tab === "provider" ? (
					<ProviderPagePreview {...previewProps} />
				) : tab === "model" ? (
					<ModelCardPreview {...previewProps} />
				) : (
					<DirectoryCardPreview {...previewProps} />
				)}
			</div>
		</section>
	);
}
