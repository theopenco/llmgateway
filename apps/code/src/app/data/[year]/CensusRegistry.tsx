"use client";

import {
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	Search,
	X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
	applyCensusQuery,
	DEFAULT_QUERY,
	defaultDir,
	formatScore,
	isFiltered,
	MIN_ENTRY_OPTIONS,
	recommendStatus,
	serializeCensusQuery,
	SORT_KEYS,
	SORT_LABELS,
	USE_CASE_LABELS,
	labelForUseCase,
} from "./census-shared";

import type { CensusModel, CensusQuery, SortKey } from "./census-shared";
import type { ReactNode } from "react";

interface CensusRegistryProps {
	year: number;
	models: CensusModel[];
	vendors: { id: string; name: string }[];
	vendorMarks: Record<string, ReactNode>;
	initialQuery: CensusQuery;
	minResponses: number;
	modelHrefBase: string;
}

const STATUS_TONES = {
	emerald: "border-emerald-400/60 text-emerald-300",
	amber: "border-amber-400/60 text-amber-300",
	stone: "border-stone-400/50 text-stone-300",
} as const;

const SEGMENTS = [0, 1, 2, 3, 4];

function ScoreMeter({ value }: { value: number }) {
	return (
		<div aria-hidden="true" className="flex gap-0.5">
			{SEGMENTS.map((segment) => {
				const fill = Math.max(0, Math.min(1, value - segment));
				return (
					<span
						key={segment}
						className="relative h-1.5 w-3 overflow-hidden rounded-[2px] bg-white/10"
					>
						<span
							className="absolute inset-y-0 left-0 bg-emerald-400"
							style={{ width: `${fill * 100}%` }}
						/>
					</span>
				);
			})}
		</div>
	);
}

function ScoreCell({
	value,
	label,
	active,
}: {
	value: number;
	label: string;
	active: boolean;
}) {
	return (
		<td
			className={cn(
				"px-3 py-4 align-middle",
				active && "bg-emerald-400/[0.06]",
			)}
		>
			<div className="flex flex-col items-end gap-1.5">
				<span className="font-mono text-lg font-semibold tabular-nums leading-none">
					{formatScore(value)}
					<span className="sr-only"> out of 5 {label}</span>
				</span>
				<ScoreMeter value={value} />
			</div>
		</td>
	);
}

function StatusBadge({ percent }: { percent: number }) {
	const status = recommendStatus(percent);
	return (
		<span
			title={status.description}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.2em]",
				STATUS_TONES[status.tone],
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"h-1.5 w-1.5 rounded-full",
					status.tone === "emerald" && "bg-emerald-400",
					status.tone === "amber" && "bg-amber-400",
					status.tone === "stone" && "bg-stone-400",
				)}
			/>
			{status.label}
			<span className="sr-only">: {status.description}</span>
		</span>
	);
}

function Chip({
	pressed,
	onClick,
	children,
	className,
}: {
	pressed: boolean;
	onClick: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"inline-flex h-8 touch-manipulation items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				pressed
					? "border-emerald-700 bg-emerald-700 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-emerald-950"
					: "border-stone-300 bg-background text-foreground hover:border-stone-500 dark:border-stone-700 dark:hover:border-stone-500",
				className,
			)}
		>
			{children}
		</button>
	);
}

export function CensusRegistry({
	year,
	models,
	vendors,
	vendorMarks,
	initialQuery,
	minResponses,
	modelHrefBase,
}: CensusRegistryProps) {
	const pathname = usePathname();
	const modelHref = (modelId: string) =>
		`${modelHrefBase}/models/${encodeURIComponent(modelId)}`;
	const [query, setQuery] = useState<CensusQuery>(initialQuery);
	const firstRender = useRef(true);

	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		window.history.replaceState(
			window.history.state,
			"",
			`${pathname}${serializeCensusQuery(query)}`,
		);
	}, [query, pathname]);

	const visible = useMemo(
		() => applyCensusQuery(models, query),
		[models, query],
	);
	const filtered = isFiltered(query);
	// Remount the rows (replaying the entrance stagger) on sort and filter
	// clicks, but not on every search keystroke.
	const headerKey = `${query.sort}-${query.dir}-${query.vendors.join()}-${query.useCase}-${query.minEntries}`;

	const update = (patch: Partial<CensusQuery>) =>
		setQuery((prev) => ({ ...prev, ...patch }));

	const setSort = (sort: SortKey) =>
		setQuery((prev) =>
			prev.sort === sort
				? { ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }
				: { ...prev, sort, dir: defaultDir(sort) },
		);

	const toggleVendor = (vendorId: string) =>
		setQuery((prev) => ({
			...prev,
			vendors: prev.vendors.includes(vendorId)
				? prev.vendors.filter((v) => v !== vendorId)
				: [...prev.vendors, vendorId],
		}));

	const columns: {
		key: SortKey;
		label: string;
		align: "left" | "right";
		hint: string;
	}[] = [
		{ key: "value", label: "Value", align: "right", hint: "Value for money" },
		{
			key: "quality",
			label: "Quality",
			align: "right",
			hint: "Output quality",
		},
		{ key: "speed", label: "Speed", align: "right", hint: "Speed" },
		{
			key: "recommend",
			label: "Recommend",
			align: "right",
			hint: "Would recommend",
		},
		{
			key: "entries",
			label: "Ratings",
			align: "right",
			hint: "Verified ratings",
		},
	];

	const ariaSort = (key: SortKey) =>
		query.sort === key
			? query.dir === "asc"
				? "ascending"
				: "descending"
			: "none";

	const DirIcon = query.dir === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

	return (
		<div>
			{/* Toolbar */}
			<form
				role="search"
				aria-label="Filter and sort the registry"
				onSubmit={(event) => event.preventDefault()}
				className="rounded-2xl border border-stone-300/90 bg-stone-50/80 p-4 dark:border-stone-700 dark:bg-stone-900/40"
			>
				<div className="flex flex-wrap items-end gap-3">
					<div className="min-w-[14rem] flex-1">
						<label
							htmlFor="census-search"
							className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400"
						>
							Search
						</label>
						<div className="relative">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-500"
							/>
							<Input
								id="census-search"
								name="q"
								type="search"
								spellCheck={false}
								value={query.q}
								onChange={(event) => update({ q: event.target.value })}
								placeholder="Model or vendor…"
								autoComplete="off"
								className="h-9 bg-background pl-9"
							/>
						</div>
					</div>

					<div>
						<label
							htmlFor="census-use-case"
							className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400"
						>
							Use case
						</label>
						<Select
							value={query.useCase ?? "any"}
							onValueChange={(value) =>
								update({ useCase: value === "any" ? null : value })
							}
						>
							<SelectTrigger
								id="census-use-case"
								className="h-9 min-w-[11rem] bg-background"
							>
								<SelectValue placeholder="Any use case" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="any">Any use case</SelectItem>
								{Object.entries(USE_CASE_LABELS).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<fieldset>
						<legend className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
							Ratings
						</legend>
						<div className="flex gap-1">
							{MIN_ENTRY_OPTIONS.map((option) => (
								<Chip
									key={option}
									pressed={query.minEntries === option}
									onClick={() => update({ minEntries: option })}
									className="h-9 rounded-md px-2.5 font-mono"
								>
									{option === 0 ? `${minResponses}+` : `${option}+`}
								</Chip>
							))}
						</div>
					</fieldset>

					<div className="flex items-end gap-1 md:hidden">
						<div>
							<label
								htmlFor="census-sort"
								className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400"
							>
								Sort by
							</label>
							<Select
								value={query.sort}
								onValueChange={(value) => {
									const sort = value as SortKey;
									update({ sort, dir: defaultDir(sort) });
								}}
							>
								<SelectTrigger
									id="census-sort"
									className="h-9 min-w-[9rem] bg-background"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SORT_KEYS.map((key) => (
										<SelectItem key={key} value={key}>
											{SORT_LABELS[key]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={
								query.dir === "asc"
									? "Sorted ascending. Switch to descending"
									: "Sorted descending. Switch to ascending"
							}
							onClick={() =>
								update({ dir: query.dir === "asc" ? "desc" : "asc" })
							}
						>
							<DirIcon aria-hidden="true" />
						</Button>
					</div>

					{filtered && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-9"
							onClick={() =>
								setQuery({ ...DEFAULT_QUERY, sort: query.sort, dir: query.dir })
							}
						>
							<X aria-hidden="true" />
							Reset filters
						</Button>
					)}
				</div>

				<fieldset className="mt-4">
					<legend className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600 dark:text-stone-400">
						Vendor
					</legend>
					<div className="flex flex-wrap gap-1.5">
						{vendors.map((vendor) => (
							<Chip
								key={vendor.id}
								pressed={query.vendors.includes(vendor.id)}
								onClick={() => toggleVendor(vendor.id)}
							>
								<span className="inline-flex h-4 w-4 items-center justify-center [&>*]:h-4 [&>*]:w-4">
									{vendorMarks[vendor.id]}
								</span>
								{vendor.name}
							</Chip>
						))}
					</div>
				</fieldset>
			</form>

			<p
				aria-live="polite"
				className="mt-4 mb-3 flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs text-stone-600 dark:text-stone-400"
			>
				<span>
					Showing {visible.length} of {models.length} models
					{filtered ? " · filters applied" : ""} · sorted by{" "}
					{SORT_LABELS[query.sort].toLowerCase()}{" "}
					{query.dir === "asc" ? "ascending" : "descending"}
				</span>
				<span className="tracking-[0.2em]">DOC. CS-{year}</span>
			</p>

			{/* Departures board */}
			<div className="census-board overflow-hidden rounded-2xl border border-white/10 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)]">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
					<p className="flex items-center gap-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-[#ece7d9]">
						<span
							aria-hidden="true"
							className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse"
						/>
						Departures · Coding models
					</p>
					<p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#b3bcb6]">
						Rank = registry position by value · refreshed every 5 min
					</p>
				</div>

				{visible.length === 0 ? (
					<div className="px-6 py-16 text-center">
						<p className="font-mono text-sm uppercase tracking-[0.3em] text-[#ece7d9]">
							No models match
						</p>
						<p className="mt-2 text-sm text-[#b3bcb6]">
							Loosen a filter or clear the search to bring the board back.
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-5 border-white/20 bg-transparent text-[#ece7d9] hover:bg-white/10 hover:text-white"
							onClick={() =>
								setQuery({ ...DEFAULT_QUERY, sort: query.sort, dir: query.dir })
							}
						>
							Reset filters
						</Button>
					</div>
				) : (
					<>
						{/* Desktop table */}
						<div className="hidden overflow-x-auto md:block">
							<table className="w-full min-w-[56rem] border-collapse text-[#ece7d9]">
								<caption className="sr-only">
									The {year} DevPass Model Census registry. Scores are 1–5
									averages from verified DevPass developers.
								</caption>
								<thead>
									<tr className="border-b border-white/10 font-mono text-[11px] uppercase tracking-[0.2em] text-[#cfd6d1]">
										<th scope="col" className="px-3 py-3 text-left sm:pl-5">
											<span className="sr-only">Registry rank</span>
											<span aria-hidden="true">#</span>
										</th>
										<th
											scope="col"
											aria-sort={ariaSort("name")}
											className="px-3 py-3 text-left"
										>
											<button
												type="button"
												onClick={() => setSort("name")}
												className={cn(
													"-mx-1 inline-flex min-h-6 items-center gap-1.5 rounded-sm px-1 uppercase tracking-[0.2em] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-400",
													query.sort === "name" && "text-white",
												)}
											>
												Model
												{query.sort === "name" && (
													<DirIcon aria-hidden="true" className="h-3.5 w-3.5" />
												)}
											</button>
										</th>
										{columns.map((column) => (
											<th
												key={column.key}
												scope="col"
												aria-sort={ariaSort(column.key)}
												className={cn(
													"px-3 py-3 text-right",
													query.sort === column.key && "bg-emerald-400/[0.06]",
												)}
											>
												<button
													type="button"
													onClick={() => setSort(column.key)}
													title={`Sort by ${column.hint.toLowerCase()}`}
													className={cn(
														"-mx-1 inline-flex min-h-6 items-center gap-1.5 rounded-sm px-1 uppercase tracking-[0.2em] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-400",
														query.sort === column.key && "text-white",
													)}
												>
													{column.label}
													{query.sort === column.key && (
														<DirIcon
															aria-hidden="true"
															className="h-3.5 w-3.5"
														/>
													)}
												</button>
											</th>
										))}
										<th scope="col" className="px-3 py-3 text-right sm:pr-5">
											Status
										</th>
									</tr>
								</thead>
								<tbody key={headerKey}>
									{visible.map((model, index) => (
										<tr
											key={model.modelId}
											className={cn(
												"border-b border-white/[0.07] transition-colors last:border-b-0 hover:bg-white/[0.04]",
												index < 12 &&
													"motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:fill-mode-both",
											)}
											style={
												index < 12
													? { animationDelay: `${index * 45}ms` }
													: undefined
											}
										>
											<td className="px-3 py-4 align-middle sm:pl-5">
												<span
													className={cn(
														"inline-flex h-9 w-9 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums",
														model.rank === 1
															? "border-[3px] border-double border-emerald-400/80 text-emerald-300"
															: model.rank <= 3
																? "border border-emerald-400/50 text-emerald-200"
																: "border border-dashed border-white/20 text-[#cfd6d1]",
													)}
												>
													{model.rank}
												</span>
											</td>
											<th
												scope="row"
												className="px-3 py-4 text-left align-middle font-normal"
											>
												<div className="flex items-center gap-3">
													<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[#ece7d9] [&>*]:h-5 [&>*]:w-5">
														{vendorMarks[model.vendorId]}
													</span>
													<div className="min-w-0">
														<a
															href={modelHref(model.modelId)}
															className="font-display block truncate rounded-sm text-base font-semibold leading-tight outline-none hover:underline focus-visible:ring-2 focus-visible:ring-emerald-400"
														>
															{model.name}
														</a>
														<div className="mt-0.5 truncate font-mono text-[11px] text-[#b3bcb6]">
															{model.vendorName} · {model.modelId}
															{model.topUseCase
																? ` · mostly ${labelForUseCase(model.topUseCase).toLowerCase()}`
																: ""}
														</div>
													</div>
												</div>
											</th>
											<ScoreCell
												value={model.avgValueScore}
												label="value"
												active={query.sort === "value"}
											/>
											<ScoreCell
												value={model.avgQualityScore}
												label="quality"
												active={query.sort === "quality"}
											/>
											<ScoreCell
												value={model.avgSpeedScore}
												label="speed"
												active={query.sort === "speed"}
											/>
											<td
												className={cn(
													"px-3 py-4 text-right align-middle font-mono text-lg font-semibold tabular-nums",
													query.sort === "recommend" && "bg-emerald-400/[0.06]",
												)}
											>
												{model.recommendPercent}%
											</td>
											<td
												className={cn(
													"px-3 py-4 text-right align-middle font-mono text-base tabular-nums text-[#cfd6d1]",
													query.sort === "entries" && "bg-emerald-400/[0.06]",
												)}
											>
												{model.responseCount}
											</td>
											<td className="px-3 py-4 text-right align-middle sm:pr-5">
												<StatusBadge percent={model.recommendPercent} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{/* Mobile cards */}
						<ul
							key={`m-${headerKey}`}
							className="divide-y divide-white/[0.07] md:hidden"
						>
							{visible.map((model, index) => (
								<li
									key={model.modelId}
									className={cn(
										"px-4 py-4 text-[#ece7d9]",
										index < 8 &&
											"motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:fill-mode-both",
									)}
									style={
										index < 8
											? { animationDelay: `${index * 45}ms` }
											: undefined
									}
								>
									<div className="flex items-center gap-3">
										<span
											className={cn(
												"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums",
												model.rank === 1
													? "border-[3px] border-double border-emerald-400/80 text-emerald-300"
													: "border border-dashed border-white/20 text-[#cfd6d1]",
											)}
										>
											{model.rank}
										</span>
										<div className="min-w-0 flex-1">
											<h3 className="font-display truncate text-base font-semibold leading-tight">
												<a
													href={modelHref(model.modelId)}
													className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-emerald-400"
												>
													{model.name}
												</a>
											</h3>
											<p className="mt-0.5 truncate font-mono text-[11px] text-[#b3bcb6]">
												{model.vendorName} · {model.responseCount} ratings
											</p>
										</div>
										<div className="text-right">
											<p className="font-mono text-xl font-bold tabular-nums leading-none">
												{model.recommendPercent}%
											</p>
											<p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#b3bcb6]">
												recommend
											</p>
										</div>
									</div>
									<dl className="mt-3 grid grid-cols-3 gap-2">
										{[
											{ label: "Value", value: model.avgValueScore },
											{ label: "Quality", value: model.avgQualityScore },
											{ label: "Speed", value: model.avgSpeedScore },
										].map((score) => (
											<div
												key={score.label}
												className="rounded-md bg-white/[0.05] px-2.5 py-2"
											>
												<dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b3bcb6]">
													{score.label}
												</dt>
												<dd className="mt-1 flex items-center justify-between gap-2">
													<span className="font-mono text-base font-semibold tabular-nums">
														{formatScore(score.value)}
													</span>
													<ScoreMeter value={score.value} />
												</dd>
											</div>
										))}
									</dl>
									<div className="mt-3 flex items-center justify-between gap-2">
										<span className="truncate font-mono text-[11px] text-[#b3bcb6]">
											{model.topUseCase
												? `Mostly ${labelForUseCase(model.topUseCase).toLowerCase()}`
												: "Use case n/a"}
										</span>
										<StatusBadge percent={model.recommendPercent} />
									</div>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
		</div>
	);
}
