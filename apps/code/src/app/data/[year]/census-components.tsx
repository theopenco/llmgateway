import { Stamp } from "lucide-react";

import { cn } from "@/lib/utils";

import {
	ProviderIcons,
	type ProviderIconKey,
} from "@llmgateway/shared/components";

import { formatScore, labelForUseCase } from "./census-shared";

import type { CensusModel } from "./census-shared";
import type { ModelSurveyResults } from "@/lib/model-survey";
import type { ReactNode } from "react";

// Catalogue families that share another provider's mark.
const ICON_ALIASES: Record<string, ProviderIconKey> = {
	google: "google-ai-studio",
};

export function VendorMark({
	vendorId,
	vendorName,
	className,
}: {
	vendorId: string;
	vendorName: string;
	className?: string;
}) {
	const key = ICON_ALIASES[vendorId] ?? vendorId;
	const Icon =
		key in ProviderIcons ? ProviderIcons[key as ProviderIconKey] : null;
	if (Icon) {
		return <Icon className={cn("shrink-0", className)} aria-hidden="true" />;
	}
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center rounded-full border border-current font-mono text-[10px] font-bold uppercase leading-none",
				className,
			)}
		>
			{vendorName.slice(0, 2)}
		</span>
	);
}

const STAMP_TONES = {
	emerald:
		"border-emerald-700/80 text-emerald-800 dark:border-emerald-400/80 dark:text-emerald-300",
	amber:
		"border-amber-700/80 text-amber-800 dark:border-amber-400/80 dark:text-amber-300",
	indigo:
		"border-indigo-700/80 text-indigo-800 dark:border-indigo-400/80 dark:text-indigo-300",
	stone:
		"border-stone-600/80 text-stone-700 dark:border-stone-400/80 dark:text-stone-300",
} as const;

export function VisaStamp({
	children,
	sub,
	tone = "emerald",
	rotate = -6,
	className,
}: {
	children: ReactNode;
	sub?: ReactNode;
	tone?: keyof typeof STAMP_TONES;
	rotate?: number;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"inline-flex flex-col items-center rounded-md border-4 border-double px-4 py-2 text-center font-mono uppercase mix-blend-multiply dark:mix-blend-screen",
				STAMP_TONES[tone],
				className,
			)}
			style={{ transform: `rotate(${rotate}deg)` }}
		>
			<span className="text-xs font-bold tracking-[0.3em] sm:text-sm">
				{children}
			</span>
			{sub ? (
				<span className="mt-0.5 text-[10px] tracking-[0.2em]">{sub}</span>
			) : null}
		</div>
	);
}

/** Machine-readable-zone line: uppercase, non-alphanumerics become fillers, padded to `length`. */
export function mrz(parts: (string | number)[], length = 44): string {
	const text = parts
		.map((part) =>
			String(part)
				.toUpperCase()
				.replace(/[^A-Z0-9]+/g, "<"),
		)
		.join("<<");
	return text.slice(0, length).padEnd(length, "<");
}

export function MrzLines({ lines }: { lines: string[] }) {
	return (
		<div
			aria-hidden="true"
			className="select-none overflow-hidden font-mono text-[11px] leading-5 tracking-[0.22em] text-stone-600 dark:text-stone-400"
		>
			{lines.map((line) => (
				<div key={line} className="whitespace-nowrap">
					{line}
				</div>
			))}
		</div>
	);
}

export function Barcode({ className }: { className?: string }) {
	return (
		<div
			aria-hidden="true"
			className={cn("h-9 w-full", className)}
			style={{
				backgroundImage:
					"repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px, currentColor 4px 5px, transparent 5px 8px, currentColor 8px 11px, transparent 11px 13px, currentColor 13px 14px, transparent 14px 18px)",
			}}
		/>
	);
}

export function PassportDataPage({
	year,
	results,
	isCurrentYear,
	quarter,
}: {
	year: number;
	results: ModelSurveyResults;
	isCurrentYear: boolean;
	quarter: number;
}) {
	const fields = [
		{ label: "Entries filed", value: results.totalResponses },
		{ label: "Developers reporting", value: results.totalRespondents },
		{ label: "Models on registry", value: results.totalModelsRated },
	];
	return (
		<section
			aria-labelledby="census-doc-title"
			className="census-paper relative overflow-hidden rounded-2xl border border-stone-300/90 shadow-[0_30px_70px_-40px_rgba(6,78,59,0.45)] dark:border-stone-700"
		>
			<Stamp
				aria-hidden="true"
				className="pointer-events-none absolute -right-8 -bottom-8 h-44 w-44 text-emerald-900/[0.07] dark:text-emerald-300/[0.06]"
			/>
			<div className="flex items-start justify-between gap-4 border-b border-dashed border-stone-400/70 px-5 py-4 dark:border-stone-600/70">
				<div className="min-w-0">
					<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-800 dark:text-emerald-300">
						DevPass · Model Census
					</p>
					<h2
						id="census-doc-title"
						className="font-display mt-1 text-xl font-bold leading-tight text-balance"
					>
						Registry of coding models
					</h2>
				</div>
				<VisaStamp
					rotate={6}
					className="mt-1 shrink-0"
					sub={isCurrentYear ? "Filing now" : "Registry closed"}
				>
					{isCurrentYear ? `Open · Q${quarter}` : `Final ${year}`}
				</VisaStamp>
			</div>

			<dl className="grid grid-cols-3 gap-x-3 gap-y-4 px-5 pt-5 pb-4">
				{fields.map((field) => (
					<div key={field.label} className="min-w-0">
						<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
							{field.label}
						</dt>
						<dd className="mt-1 font-mono text-2xl font-bold tabular-nums sm:text-3xl">
							{field.value.toLocaleString("en-US")}
						</dd>
					</div>
				))}
				<div className="min-w-0">
					<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
						Wave
					</dt>
					<dd className="mt-1 font-mono text-sm font-semibold">
						{isCurrentYear ? `Q${quarter} · filing now` : "All four filed"}
					</dd>
				</div>
				<div className="min-w-0">
					<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
						Listing rule
					</dt>
					<dd className="mt-1 font-mono text-sm font-semibold">
						{results.minResponses}+ verified ratings
					</dd>
				</div>
				<div className="min-w-0">
					<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
						Scale
					</dt>
					<dd className="mt-1 font-mono text-sm font-semibold">1–5 averages</dd>
				</div>
			</dl>

			<div className="border-t border-dashed border-stone-400/70 px-5 pt-3 pb-4 dark:border-stone-600/70">
				<p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-stone-600 dark:text-stone-400">
					Doc. CS-{year} · issued by LLM Gateway
				</p>
				<MrzLines
					lines={[
						mrz(["P", "DEVPASS", "MODEL", "CENSUS", year]),
						mrz([
							`CS${year}`,
							results.totalResponses,
							results.totalRespondents,
							results.totalModelsRated,
							"LLMGATEWAY",
						]),
					]}
				/>
			</div>
		</section>
	);
}

export function BoardingPass({
	title,
	code,
	model,
	score,
	scoreLabel,
	year,
	delayMs,
}: {
	title: string;
	code: string;
	model: CensusModel;
	score: number;
	scoreLabel: string;
	year: number;
	delayMs: number;
}) {
	const topUseCase = model.topUseCase ? labelForUseCase(model.topUseCase) : "—";
	return (
		<article
			aria-label={`${title}: ${model.name}`}
			className="census-paper relative grid grid-cols-[minmax(0,1fr)_6.5rem] overflow-hidden rounded-2xl border border-stone-300/90 shadow-[0_24px_50px_-32px_rgba(28,25,23,0.5)] transition-transform duration-300 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:hover:-translate-y-1 dark:border-stone-700"
			style={{ animationDelay: `${delayMs}ms` }}
		>
			<div className="min-w-0 p-5">
				<div className="flex items-start justify-between gap-3">
					<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-800 dark:text-emerald-300">
						Boarding pass · {title}
					</p>
					<VendorMark
						vendorId={model.vendorId}
						vendorName={model.vendorName}
						className="h-6 w-6 text-stone-700 dark:text-stone-200"
					/>
				</div>
				<h3 className="font-display mt-3 truncate text-2xl font-bold leading-tight tracking-tight">
					{model.name}
				</h3>
				<p className="mt-1 truncate font-mono text-xs text-stone-600 dark:text-stone-400">
					{model.modelId} · {model.vendorName}
				</p>
				<dl className="mt-4 grid grid-cols-[minmax(0,1.4fr)_auto_auto] gap-x-4 gap-y-3 text-sm">
					<div className="min-w-0">
						<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
							Gate
						</dt>
						<dd className="mt-0.5 font-medium leading-snug">{topUseCase}</dd>
					</div>
					<div>
						<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
							Ratings
						</dt>
						<dd className="mt-0.5 font-mono font-semibold tabular-nums">
							{model.responseCount}
						</dd>
					</div>
					<div>
						<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
							Recommend
						</dt>
						<dd className="mt-0.5 font-mono font-semibold tabular-nums">
							{model.recommendPercent}%
						</dd>
					</div>
					<div className="col-span-3">
						<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
							Value · Quality · Speed
						</dt>
						<dd className="mt-0.5 font-mono font-semibold tabular-nums">
							{formatScore(model.avgValueScore)} ·{" "}
							{formatScore(model.avgQualityScore)} ·{" "}
							{formatScore(model.avgSpeedScore)}
						</dd>
					</div>
				</dl>
			</div>

			<div
				aria-hidden="true"
				className="absolute top-0 bottom-0 right-[6.5rem] w-0 border-l-2 border-dashed border-stone-400/70 dark:border-stone-600"
			>
				<span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-background" />
				<span className="absolute -bottom-3 -left-3 h-6 w-6 rounded-full bg-background" />
			</div>

			<div className="flex flex-col items-center justify-between bg-emerald-800 px-3 py-4 text-emerald-50 dark:bg-emerald-700">
				<p className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-100">
					{code}
				</p>
				<div className="text-center">
					<p className="font-mono text-4xl font-bold leading-none tabular-nums">
						{formatScore(score)}
					</p>
					<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-100">
						out of 5
						<span className="sr-only"> for {scoreLabel.toLowerCase()}</span>
					</p>
				</div>
				<Barcode className="text-emerald-200/80" />
				<p className="font-mono text-[9px] tracking-[0.2em] text-emerald-100">
					CS-{year}-{String(model.rank).padStart(2, "0")}
				</p>
			</div>
		</article>
	);
}
