import Link from "next/link";

import { CiteThis } from "@/components/seo/cite-this";
import { DataAsOf } from "@/components/seo/data-as-of";

import { MARKETING_STATS } from "@llmgateway/shared";

const rows = [
	{
		option: "Pay-as-you-go credits",
		price: "No subscription",
		fee: `${MARKETING_STATS.platformFee} on credit purchases`,
		tokens: "Provider list rates",
	},
	{
		option: "Bring your own keys",
		price: "Free",
		fee: "None",
		tokens: "Billed by your provider",
	},
	{
		option: "Self-hosted (AGPLv3)",
		price: "Free",
		fee: "None",
		tokens: "Billed by your provider",
	},
	{
		option: "Enterprise",
		price: "Custom",
		fee: "Volume discounts",
		tokens: "Provider list rates",
	},
];

/**
 * The pricing model as plain, server-rendered text and one table, so search
 * engines and AI assistants can quote it without running the page's scripts.
 */
export function PricingSummary() {
	return (
		<section
			aria-labelledby="pricing-summary-heading"
			className="container mx-auto max-w-4xl px-4 py-16"
		>
			<h2
				id="pricing-summary-heading"
				className="text-2xl font-bold tracking-tight md:text-3xl"
			>
				How much does LLM Gateway cost?
			</h2>
			<p className="mt-4 text-muted-foreground md:text-lg">
				LLM Gateway charges the provider&apos;s per-token rate with no markup on
				tokens. Buying credits adds a flat {MARKETING_STATS.platformFee}{" "}
				platform fee, plus {MARKETING_STATS.internationalCardFee} for
				international cards. Using your own provider keys is free, and so is
				self-hosting the open-source gateway.
			</p>
			<div className="mt-6 overflow-x-auto rounded-2xl border">
				<table className="w-full min-w-[560px] text-left text-sm">
					<thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
						<tr>
							<th scope="col" className="px-4 py-3 font-medium">
								Option
							</th>
							<th scope="col" className="px-4 py-3 font-medium">
								Price
							</th>
							<th scope="col" className="px-4 py-3 font-medium">
								Platform fee
							</th>
							<th scope="col" className="px-4 py-3 font-medium">
								Token prices
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{rows.map((row) => (
							<tr key={row.option}>
								<th scope="row" className="px-4 py-3 font-medium">
									{row.option}
								</th>
								<td className="px-4 py-3">{row.price}</td>
								<td className="px-4 py-3">{row.fee}</td>
								<td className="px-4 py-3 text-muted-foreground">
									{row.tokens}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="mt-4 text-sm text-muted-foreground">
				Per-model token prices are on the{" "}
				<Link href="/models" className="underline">
					models page
				</Link>
				, and per-image prices on the{" "}
				<Link href="/products/image-generation" className="underline">
					image generation page
				</Link>
				.
			</p>
			<DataAsOf label="Pricing as of" className="mt-3" />
			<div className="mt-4">
				<CiteThis citation='LLM Gateway, "LLM API Pricing". https://llmgateway.io/pricing' />
			</div>
		</section>
	);
}
