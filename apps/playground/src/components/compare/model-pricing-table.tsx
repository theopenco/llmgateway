import { ThemTile, UsTile } from "@/components/compare/logo-faceoff";
import { cn } from "@/lib/utils";

import type { ModelPricing } from "@/lib/comparisons";

interface ModelPricingTableProps {
	competitor: string;
	slug: string;
	pricing: ModelPricing;
	/** Plus multiplier when memberships pay for this studio, else undefined. */
	plusMultiplier?: number;
}

function formatRate(value: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: value < 1 ? 3 : 2,
	}).format(value);
}

export function ModelPricingTable({
	competitor,
	slug,
	pricing,
	plusMultiplier,
}: ModelPricingTableProps) {
	const showPlus = plusMultiplier !== undefined;
	const hasCompetitorRates = pricing.rows.some(
		(row) => row.them !== null && row.us !== null,
	);
	const themName = pricing.themName ?? competitor;
	const columns = showPlus
		? "grid-cols-[1.5fr_1fr_1fr_1fr]"
		: "grid-cols-[1.6fr_1fr_1fr]";

	return (
		<div>
			<p className="mb-5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
				{pricing.intro}
			</p>
			<div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
				<div className="min-w-[560px]">
					<div
						className={cn(
							"grid border-b bg-muted/40 text-sm font-semibold",
							columns,
						)}
					>
						<div className="px-4 py-4 text-muted-foreground sm:px-5">
							Model · {pricing.unit}
						</div>
						<div className="flex items-center gap-2 border-l px-4 py-4 sm:px-5">
							<UsTile size={22} radius={6} />
							Lounge
						</div>
						{showPlus ? (
							<div className="flex items-center border-l px-4 py-4 sm:px-5">
								On Plus
							</div>
						) : null}
						<div className="flex items-center gap-2 border-l px-4 py-4 sm:px-5">
							<ThemTile
								slug={slug}
								competitor={competitor}
								size={22}
								radius={6}
							/>
							<span className="truncate">{themName}</span>
						</div>
					</div>
					{pricing.rows.map((row, idx) => {
						const { us, them } = row;
						const cheaper = us !== null && them !== null && us < them;
						const plusRate =
							us !== null && plusMultiplier !== undefined
								? us / plusMultiplier
								: null;
						return (
							<div
								key={row.model}
								className={cn(
									"grid text-sm tabular-nums",
									columns,
									idx % 2 === 1 && "bg-muted/20",
								)}
							>
								<div className="px-4 py-3.5 font-medium sm:px-5">
									{row.model}
								</div>
								<div
									className={cn(
										"border-l px-4 py-3.5 font-mono sm:px-5",
										cheaper &&
											"font-semibold text-emerald-600 dark:text-emerald-400",
									)}
								>
									{us !== null ? (
										formatRate(us)
									) : (
										<span className="font-sans text-muted-foreground">
											{row.usLabel ?? "—"}
										</span>
									)}
								</div>
								{showPlus ? (
									<div className="border-l px-4 py-3.5 font-mono text-foreground sm:px-5">
										{plusRate !== null ? formatRate(plusRate) : "—"}
									</div>
								) : null}
								<div className="border-l px-4 py-3.5 font-mono text-muted-foreground sm:px-5">
									{them !== null ? (
										formatRate(them)
									) : (
										<span className="font-sans">{row.themLabel ?? "—"}</span>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				{themName} rates from{" "}
				{pricing.sources.map((source, index) => (
					<span key={source.url}>
						{index > 0 ? ", " : null}
						<a
							href={source.url}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2 hover:text-foreground"
						>
							{source.label}
						</a>
					</span>
				))}
				, checked {pricing.checkedOn}. Lounge rates are live catalogue rates.
				{plusMultiplier !== undefined
					? ` On Plus is that rate spread over the membership's ${plusMultiplier}× credit value.`
					: ""}
				{hasCompetitorRates ? " Green means the Lounge rate is lower." : ""}
			</p>
		</div>
	);
}
