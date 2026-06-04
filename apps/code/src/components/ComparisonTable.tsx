import { Check, Minus } from "lucide-react";

interface FeatureRow {
	label: string;
	devpass: string | boolean;
	competitor: string | boolean;
	highlight?: boolean;
}

function Cell({ value }: { value: string | boolean }) {
	if (typeof value === "boolean") {
		return (
			<>
				{value ? (
					<Check
						aria-hidden="true"
						className="mx-auto h-4 w-4 text-foreground/70"
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
	features,
}: {
	competitor: string;
	features: FeatureRow[];
}) {
	return (
		<div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
							<th className="px-5 py-4 font-medium">Feature</th>
							<th className="px-5 py-4 text-center font-medium">
								<span className="font-semibold text-foreground">DevPass</span>
							</th>
							<th className="px-5 py-4 text-center font-medium">
								<span className="font-semibold text-foreground">
									{competitor}
								</span>
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
								<td className="px-5 py-3.5 text-center bg-muted/20">
									<Cell value={row.devpass} />
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
