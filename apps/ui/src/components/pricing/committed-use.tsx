import { ArrowRight } from "lucide-react";

import { TrackedLink } from "@/components/home/tracked-link";

import { MARKETING_STATS } from "@llmgateway/shared";

const terms = [
	{
		label: "Platform fee",
		payAsYouGo: `${MARKETING_STATS.platformFee} on credits`,
		committed: "Volume discounts",
	},
	{
		label: "Billing",
		payAsYouGo: "Prepaid top-ups",
		committed: "Invoicing options",
	},
	{
		label: "Service level",
		payAsYouGo: "No contractual SLA",
		committed: `${MARKETING_STATS.uptimeSla} uptime SLA`,
	},
	{
		label: "Support",
		payAsYouGo: "Discord community",
		committed: "24/7 SLA + Slack channel",
	},
];

export function CommittedUse({ location }: { location: string }) {
	return (
		<section id="committed-use" className="scroll-mt-24 py-16 sm:py-24">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
					<div>
						<p className="mb-3 font-mono text-xs uppercase tracking-wider text-blue-600 dark:text-blue-400">
							Committed use
						</p>
						<h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
							Buying credits every month? Ask for a contract.
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground">
							Enterprise Cloud puts steady usage on a contract with volume
							discounts on the platform fee and invoicing options. It starts
							with the 30-Day Production Pilot, and Enterprise is usually priced
							from {MARKETING_STATS.enterpriseSmallTeamPrice} a year for
							small&nbsp;teams.
						</p>
						<TrackedLink
							href="/enterprise#contact"
							location={location}
							cta="committed_use"
							className="mt-6 inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:bg-foreground/90"
						>
							Ask for a quote
							<ArrowRight className="h-4 w-4" aria-hidden />
						</TrackedLink>
						<p className="mt-3 text-sm text-muted-foreground">
							A small team with a large bill? Email{" "}
							<a
								href="mailto:contact@llmgateway.io?subject=Committed%20use"
								className="whitespace-nowrap font-medium text-foreground underline underline-offset-2"
							>
								contact@llmgateway.io
							</a>
						</p>
					</div>
					<div className="overflow-hidden rounded-xl border border-border bg-card">
						<table className="w-full text-left text-sm">
							<caption className="sr-only">
								Pay as you go compared with committed use
							</caption>
							<thead>
								<tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
									<th scope="col" className="px-4 py-3 font-medium">
										<span className="sr-only">Term</span>
									</th>
									<th scope="col" className="px-4 py-3 font-medium">
										Pay as you go
									</th>
									<th
										scope="col"
										className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400"
									>
										Committed use
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{terms.map((term) => (
									<tr key={term.label}>
										<th
											scope="row"
											className="px-4 py-3.5 align-top font-medium text-foreground"
										>
											{term.label}
										</th>
										<td className="px-4 py-3.5 align-top text-muted-foreground">
											{term.payAsYouGo}
										</td>
										<td className="px-4 py-3.5 align-top font-medium text-foreground">
											{term.committed}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</section>
	);
}
