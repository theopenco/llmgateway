import { Check, Minus } from "lucide-react";

import { BrandTile } from "@/components/brand-logos";

interface FeatureRow {
	label: string;
	devpass: string | boolean;
	competitor: string | boolean;
	highlight?: boolean;
}

function Cell({
	value,
	accent,
}: {
	value: string | boolean;
	accent?: boolean;
}) {
	if (typeof value === "boolean") {
		return (
			<>
				{value ? (
					<Check
						aria-hidden="true"
						className={
							accent
								? "mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400"
								: "mx-auto h-4 w-4 text-foreground/70"
						}
					/>
				) : (
					<Minus
						aria-hidden="true"
						className="mx-auto h-4 w-4 text-muted-foreground/40"
					/>
				)}
				<span className="sr-only">{value ? "Yes" : "No"}</span>
			</>
		);
	}
	return <span className="text-sm font-medium text-foreground">{value}</span>;
}

export function ComparisonTable({
	competitor,
	competitorLogo,
	features,
}: {
	competitor: string;
	competitorLogo?: string;
	features: FeatureRow[];
}) {
	return (
		<div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
							<th className="px-5 py-4 font-medium">Feature</th>
							<th className="px-5 py-4 font-medium">
								<div className="flex items-center justify-center gap-2">
									<BrandTile brand="devpass" size={26} radius={8} />
									<span className="font-semibold text-foreground">DevPass</span>
								</div>
							</th>
							<th className="px-5 py-4 font-medium">
								<div className="flex items-center justify-center gap-2">
									<BrandTile
										brand={competitorLogo ?? competitor}
										size={26}
										radius={8}
									/>
									<span className="font-semibold text-foreground">
										{competitor}
									</span>
								</div>
							</th>
						</tr>
					</thead>
					<tbody>
						{features.map((row, idx) => (
							<tr
								key={row.label}
								className={
									idx !== features.length - 1 ? "border-b border-border/60" : ""
								}
							>
								<td
									className={`px-5 py-3.5 ${
										row.highlight
											? "font-semibold text-foreground"
											: "text-foreground/90"
									}`}
								>
									{row.label}
								</td>
								<td className="bg-muted/20 px-5 py-3.5 text-center">
									<Cell value={row.devpass} accent={row.highlight} />
								</td>
								<td className="px-5 py-3.5 text-center">
									<Cell value={row.competitor} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
