import { Check } from "lucide-react";

import { ThemTile, UsTile } from "@/components/compare/logo-faceoff";
import { cn } from "@/lib/utils";

import type { ComparisonRow } from "@/lib/comparisons";

interface ComparisonTableProps {
	competitor: string;
	slug: string;
	rows: ComparisonRow[];
}

export function ComparisonTable({
	competitor,
	slug,
	rows,
}: ComparisonTableProps) {
	return (
		<div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
			{/* Column headers */}
			<div className="grid grid-cols-[1.1fr_1fr_1fr] border-b bg-muted/40 text-sm font-semibold sm:grid-cols-[1.2fr_1fr_1fr]">
				<div className="px-4 py-4 text-muted-foreground sm:px-5">Feature</div>
				<div className="flex items-center gap-2 border-l px-4 py-4 sm:px-5">
					<UsTile size={24} radius={7} />
					<span className="leading-tight">LLM Gateway Chat</span>
				</div>
				<div className="flex items-center gap-2 border-l px-4 py-4 sm:px-5">
					<ThemTile slug={slug} competitor={competitor} size={24} radius={7} />
					<span className="leading-tight">{competitor}</span>
				</div>
			</div>

			{/* Rows */}
			{rows.map((row, idx) => (
				<div
					key={row.label}
					className={cn(
						"grid grid-cols-[1.1fr_1fr_1fr] text-sm sm:grid-cols-[1.2fr_1fr_1fr]",
						idx % 2 === 1 && "bg-muted/20",
					)}
				>
					<div className="px-4 py-4 font-medium text-foreground sm:px-5">
						{row.label}
					</div>
					<div
						className={cn(
							"flex items-start gap-2 border-l px-4 py-4 sm:px-5",
							row.usWins && "bg-emerald-500/[0.06]",
						)}
					>
						{row.usWins && (
							<Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
						)}
						<span className="text-foreground">{row.us}</span>
					</div>
					<div className="border-l px-4 py-4 text-muted-foreground sm:px-5">
						{row.them}
					</div>
				</div>
			))}
		</div>
	);
}
