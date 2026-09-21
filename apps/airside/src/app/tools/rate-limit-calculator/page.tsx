import Link from "next/link";

import { RateLimitCalculator } from "@/components/ProviderCalculators";
import { ResourcePage } from "@/components/ResourcePage";
import { resourceMetadata } from "@/lib/resources";

const path = "/tools/rate-limit-calculator";
export const metadata = resourceMetadata(path);

export default function RateTool() {
	return (
		<ResourcePage path={path}>
			<RateLimitCalculator />
			<section>
				<h2>How do RPM and RPD translate to daily capacity?</h2>
				<p>
					Multiply requests per minute (RPM) by 1,440 minutes per day. If a
					requests-per-day (RPD) limit also applies, the smaller value is the
					daily ceiling. Leave RPD blank to estimate capacity from the minute
					limit alone; a value of zero means no requests are allowed.
				</p>
			</section>
			<section>
				<h2>How much concurrency does that require?</h2>
				<p>
					At a steady minute rate, average concurrent requests equal RPM
					multiplied by average request duration in seconds, divided by 60. The
					calculator rounds up to a whole request. Streaming duration includes
					the time until the response finishes, not just the time to its first
					token.
				</p>
				<p className="mt-3">
					Concurrency here describes the full minute rate, even when a daily cap
					prevents sustaining it all day. Real services need headroom for
					bursts, slow requests and retries. Token limits and hardware
					throughput may impose lower ceilings.
				</p>
			</section>
			<section>
				<h2>Should the limit be global or per organization?</h2>
				<p>
					A global limit covers the combined traffic sent to your deployment. A
					per-organization limit gives each organization its own allowance, so
					total traffic can grow with the number of organizations. Choose the
					scope your infrastructure and commercial terms support. Platform
					limits still apply.
				</p>
			</section>
			<section>
				<h2>Does a capacity estimate predict traffic?</h2>
				<p>
					No. Capacity is a ceiling under the stated assumptions. The
					public&nbsp;
					<a href="https://llmgateway.io/rankings">model rankings</a> help you
					explore usage on LLM Gateway; your own routed traffic appears in
					Airside. Follow the&nbsp;
					<Link href="/guides/list-your-llm-api">listing guide</Link> to
					configure deployment limits.
				</p>
			</section>
		</ResourcePage>
	);
}
