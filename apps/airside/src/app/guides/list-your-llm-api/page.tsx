import Link from "next/link";

import { ResourcePage } from "@/components/ResourcePage";
import { resourceMetadata } from "@/lib/resources";

const path = "/guides/list-your-llm-api";
export const metadata = resourceMetadata(path);

export default function ListingGuide() {
	return (
		<ResourcePage path={path}>
			<section>
				<h2>What is an LLM API listing?</h2>
				<p>
					A listing makes a provider’s deployment available through LLM Gateway.
					Airside is the provider console used to verify ownership, register
					models, submit prices and inspect aggregate traffic. A verified domain
					establishes ownership; the provider claim, model checks and initial
					pricing still need clearance before a deployment enters service.
				</p>
			</section>
			<section>
				<h2>1. Prepare your provider identity</h2>
				<p>
					Use a company email and verify it. Have your API base URL and public
					website ready. The domain checks connect those addresses to the
					provider you want to claim. If your email and API domains differ,
					follow the website verification flow in onboarding. Existing catalogue
					providers can be claimed; a new provider can register a custom
					carrier.
				</p>
				<p className="mt-3">
					Onboarding shows the applicable listing fee or invite-code option
					before submission. Read the provider&nbsp;
					<Link href="/legal/terms">terms</Link> before registering.
				</p>
			</section>
			<section>
				<h2>2. Match the canonical model ID</h2>
				<p>
					The canonical model ID identifies the model across providers. The
					upstream model ID is the identifier your own API accepts. If the model
					already exists in the catalogue, use its exact canonical ID so users
					can compare deployments. Airside reuses its display name, description
					and family. A new model needs its own identity metadata.
				</p>
				<p className="mt-3">
					Check the live&nbsp;
					<a href="https://llmgateway.io/models">model catalogue</a> before
					adding a model. Providers with existing mappings should use the
					catalogue import action in Fleet.
				</p>
			</section>
			<section>
				<h2>3. Declare and verify the deployment</h2>
				<p>
					Keep Carrier default selected unless this deployment needs a different
					upstream API format. Enter the context window, output limit and
					capabilities your endpoint actually supports. Choose rate limits that
					your infrastructure can sustain, including whether a limit covers all
					organizations or applies separately to each one.
				</p>
				<p className="mt-3">
					Run preflight verification with your managed carrier key or a key
					supplied for that run. Resolve failed checks before submitting the
					model. Changing the verified mapping requires a new verification.
				</p>
			</section>
			<section>
				<h2>4. Submit prices for review</h2>
				<p>
					Enter input, output and cached-input prices per million tokens; a
					per-request charge uses a flat amount. For an existing canonical
					model, “Use catalog price” copies a selected provider’s available flat
					tariff for you to review. This is a starting point for your own
					filing. It does not bypass approval or support copying complex tiered
					pricing.
				</p>
				<p className="mt-3">
					Estimate the effect of your rates with the&nbsp;
					<Link href="/tools/token-cost-calculator">token cost calculator</Link>
					. Initial fares and later price changes take effect only after
					approval.
				</p>
			</section>
			<section>
				<h2>5. Review demand and your routed traffic</h2>
				<p>
					The public&nbsp;
					<a href="https://llmgateway.io/rankings">model rankings</a> show usage
					on LLM Gateway. Use them to explore demand, then compare with the
					aggregate requests, errors and tokens in your Airside Traffic page.
					Rankings describe gateway usage, not the entire inference market, and
					do not guarantee future traffic to a provider.
				</p>
			</section>
			<section>
				<h2>Can a provider see prompts or customer identities?</h2>
				<p>
					Airside’s traffic reports contain aggregate activity for the
					provider’s routes. They do not expose other organizations’ identities
					or request and response payloads. See the&nbsp;
					<a href="https://docs.llmgateway.io/features/airside">
						Airside documentation
					</a>{" "}
					for the operating workflow.
				</p>
			</section>
		</ResourcePage>
	);
}
