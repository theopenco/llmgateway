import Link from "next/link";

import { ResourcePage } from "@/components/ResourcePage";
import { resourceMetadata } from "@/lib/resources";

const path = "/guides/llm-inference-pricing";
export const metadata = resourceMetadata(path);

export default function PricingGuide() {
	return (
		<ResourcePage path={path}>
			<section>
				<h2>How does token pricing work?</h2>
				<p>
					LLM inference pricing commonly charges separately for input and output
					tokens. To estimate one request, multiply each token count by its
					corresponding rate per million, divide by one million and add any flat
					request charge. Cached input uses its own rate when that rate applies
					to the request.
				</p>
			</section>
			<section>
				<h2>Which price belongs in each field?</h2>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-border border-b">
								<th className="p-3">Field</th>
								<th className="p-3">Unit</th>
								<th className="p-3">Applies to</th>
							</tr>
						</thead>
						<tbody>
							{[
								["Input", "USD per million tokens", "Uncached input tokens"],
								["Output", "USD per million tokens", "Generated output tokens"],
								[
									"Cached input",
									"USD per million tokens",
									"Input tokens served from an eligible cache",
								],
								[
									"Per request",
									"USD per request",
									"Each billable request, in addition to token charges",
								],
							].map((row) => (
								<tr key={row[0]} className="border-border border-b">
									{row.map((cell) => (
										<td key={cell} className="p-3">
											{cell}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="mt-3">
					Use the&nbsp;
					<Link href="/tools/token-cost-calculator">
						token cost calculator
					</Link>{" "}
					to model your workload. Total input includes cached tokens: subtract
					the cached portion before charging the uncached input rate.
				</p>
			</section>
			<section>
				<h2>Compare like-for-like deployments</h2>
				<p>
					Start with the same canonical model, then compare context limits,
					quantization, supported features and service behavior. A low headline
					token price can represent a different deployment. Check the live&nbsp;
					<a href="https://llmgateway.io/models">catalogue</a> for current
					mappings and prices.
				</p>
				<p className="mt-3">
					Tiered, regional, time-dependent and media pricing need their own
					calculations. Airside’s catalogue-price shortcut only offers flat
					tariffs it can represent. It never turns a multi-tier offer into a
					single rate.
				</p>
			</section>
			<section>
				<h2>How do discount and gateway margin affect routing?</h2>
				<p>
					Airside lets a provider file a routing discount and the gateway margin
					it accepts. Approved settings affect routing economics alongside
					availability and performance. Changing a price or margin is not a
					promise of traffic: competing routes, supported capabilities and
					request requirements also matter.
				</p>
			</section>
			<section>
				<h2>Plan volume without mistaking capacity for demand</h2>
				<p>
					Multiply estimated request cost by the number of requests you expect
					to serve. Use measured input and output distributions from your own
					service, including longer requests, instead of assuming every request
					is average. Compare demand on the public&nbsp;
					<a href="https://llmgateway.io/rankings">rankings page</a> and check
					the ceiling implied by your&nbsp;
					<Link href="/tools/rate-limit-calculator">rate limits</Link>.
				</p>
			</section>
			<section>
				<h2>Is estimated traffic value a provider payout?</h2>
				<p>
					No. A token estimate describes usage at the rates you enter. It
					excludes infrastructure costs, discounts, gateway margin, credits and
					settlement adjustments. Airside’s traffic view is an operating report;
					payment and settlement follow the provider’s written agreement.
				</p>
			</section>
			<section>
				<h2>When do updated prices go live?</h2>
				<p>
					A price change is filed for review and applies after approval. Review
					your units, optional charges and regional prices before filing. Follow
					the&nbsp;<Link href="/guides/list-your-llm-api">listing guide</Link>{" "}
					to prepare a new deployment.
				</p>
			</section>
		</ResourcePage>
	);
}
