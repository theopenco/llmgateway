import Link from "next/link";

import { TokenCostCalculator } from "@/components/ProviderCalculators";
import { ResourcePage } from "@/components/ResourcePage";
import { resourceMetadata } from "@/lib/resources";

const path = "/tools/token-cost-calculator";
export const metadata = resourceMetadata(path);

export default function TokenTool() {
	return (
		<ResourcePage path={path}>
			<TokenCostCalculator />
			<section>
				<h2>How to calculate LLM token cost</h2>
				<p>
					Subtract cached input from total input, multiply each token category
					by its rate per million, divide by one million and add the flat
					request charge. Multiply the result by monthly requests to estimate a
					month at the same request size.
				</p>
				<pre className="bg-muted mt-4 overflow-x-auto rounded-lg p-4 text-sm">
					{
						"request cost = ((input − cached) × input rate\n  + cached × cached rate\n  + output × output rate) / 1,000,000\n  + request charge"
					}
				</pre>
			</section>
			<section>
				<h2>What if cached input has no separate price?</h2>
				<p>
					Set the cached input price equal to the input price, or enter zero
					cached tokens. A zero cached-input price means those tokens are free;
					it does not mean “use the input price.” Total input must include the
					cached portion to avoid double counting.
				</p>
			</section>
			<section>
				<h2>Where should I get the rates?</h2>
				<p>
					Use your provider’s rate card or the live&nbsp;
					<a href="https://llmgateway.io/models">model catalogue</a>. This
					calculator uses only the rates you enter and does not fetch or
					guarantee current provider pricing. Airside providers can use
					catalogue prices as a starting point when filing eligible flat
					tariffs.
				</p>
			</section>
			<section>
				<h2>What does the estimate exclude?</h2>
				<p>
					It excludes context tiers, cache-write fees, media-specific rates,
					time-based pricing, taxes, discounts and gateway margin. It is not a
					provider payout estimate. For billing units and filing behavior, read
					the&nbsp;
					<Link href="/guides/llm-inference-pricing">
						inference pricing guide
					</Link>
					.
				</p>
			</section>
		</ResourcePage>
	);
}
