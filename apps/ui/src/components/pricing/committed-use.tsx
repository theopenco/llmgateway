import { ArrowRight } from "lucide-react";

import { TrackedLink } from "@/components/home/tracked-link";

const terms = [
	{
		label: "Platform fee",
		payAsYouGo: "5% on credits",
		committed: "Lower, set by your volume",
	},
	{
		label: "Billing",
		payAsYouGo: "Prepaid top-ups",
		committed: "One invoice, on your payment terms",
	},
	{
		label: "Service level",
		payAsYouGo: "No contractual SLA",
		committed: "99.9% uptime SLA, priority incident response",
	},
	{
		label: "Support",
		payAsYouGo: "Discord community",
		committed: "Shared Slack channel",
	},
];

/**
 * The offer for an organization that already buys credits every month: the
 * same usage under an Enterprise Cloud contract. Every line restates a term
 * the pricing table and the enterprise page already publish.
 */
export function CommittedUse({ location }: { location: string }) {
	return (
		<section id="committed-use" className="scroll-mt-24 py-16 sm:py-24">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
					<div>
						<p className="mb-3 font-mono text-xs uppercase tracking-wider text-blue-500">
							Committed use
						</p>
						<h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
							Buying credits every month? Commit and pay less.
						</h2>
						<p className="mt-4 text-base leading-relaxed text-muted-foreground">
							Tell us what you spend today. We turn it into an Enterprise Cloud
							contract sized to that volume. Your organization, keys and routing
							stay as they are.
						</p>
						<TrackedLink
							href="/enterprise#contact"
							location={location}
							cta="committed_use"
							className="mt-6 inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:bg-foreground/90"
						>
							Talk to us about a commitment
							<ArrowRight className="h-4 w-4" aria-hidden />
						</TrackedLink>
					</div>
					<table className="w-full overflow-hidden rounded-xl border border-border bg-card text-left text-sm">
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
								<th scope="col" className="px-4 py-3 font-medium text-blue-500">
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
		</section>
	);
}
