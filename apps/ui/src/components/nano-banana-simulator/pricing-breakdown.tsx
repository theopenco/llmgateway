import { Badge } from "@/lib/components/badge";

const baseRows = [
	{ metric: "Text Input", google: 2.0, unit: "/1M", prefix: "" },
	{ metric: "Text Output", google: 12.0, unit: "/1M", prefix: "" },
	{ metric: "Cached Input", google: 0.2, unit: "/1M", prefix: "" },
	{ metric: "Image Output", google: 120.0, unit: "/1M", prefix: "" },
	{ metric: "Per Image (~1K)", google: 0.13, unit: "", prefix: "~" },
] as const;

function formatPrice(value: number, prefix = ""): string {
	if (value < 1) {
		return `${prefix}$${value.toFixed(3)}`;
	}
	return `${prefix}$${value.toFixed(2)}`;
}

export function PricingBreakdown({ discount }: { discount: number }) {
	// eslint-disable-next-line no-mixed-operators
	const multiplier = 1 - discount / 100;

	return (
		<section className="w-full py-12 md:py-16">
			<div className="container mx-auto px-4 md:px-6 max-w-3xl">
				<div className="text-center mb-8">
					<Badge variant="outline" className="mb-4">
						Pricing Breakdown
					</Badge>
					<h2 className="text-2xl font-bold tracking-tighter sm:text-3xl">
						Detailed Price Comparison
					</h2>
				</div>

				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b bg-muted/50">
								<th className="px-4 py-3 text-left font-medium">Metric</th>
								<th className="px-4 py-3 text-right font-medium">
									Google AI Studio
								</th>
								<th className="px-4 py-3 text-right font-medium">
									LLM Gateway
								</th>
							</tr>
						</thead>
						<tbody>
							{baseRows.map((row) => (
								<tr key={row.metric} className="border-b last:border-b-0">
									<td className="px-4 py-3 font-medium">{row.metric}</td>
									<td className="px-4 py-3 text-right text-muted-foreground">
										{formatPrice(row.google, row.prefix)}
										{row.unit}
									</td>
									<td className="px-4 py-3 text-right font-semibold text-green-600 dark:text-green-400">
										{formatPrice(row.google * multiplier, row.prefix)}
										{row.unit}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<p className="text-xs text-muted-foreground text-center mt-4">
					LLM Gateway prices reflect a {discount}% discount off Google AI Studio
					direct pricing.
				</p>
			</div>
		</section>
	);
}
