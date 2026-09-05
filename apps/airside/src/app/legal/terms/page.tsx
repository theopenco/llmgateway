import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Use",
	description:
		"Supplemental Airside Terms of Use for model providers: carrier claims and domain verification, the listing fee, tariff filings, dispatch routing, and delisting.",
	alternates: { canonical: "/legal/terms" },
	openGraph: {
		title: "Airside Supplemental Terms of Use",
		description:
			"The terms that govern listing your models as a carrier on LLM Gateway.",
		url: "https://airside.llmgateway.io/legal/terms",
		type: "article",
	},
};

export default function TermsPage() {
	return (
		<>
			<h1>Airside Supplemental Terms of Use</h1>
			<p>
				<strong>Effective Date:</strong> August 27, 2026
				<br />
				<strong>Last Updated:</strong> August 27, 2026
			</p>
			<p>
				<strong>Airside</strong> is the carrier console operated by{" "}
				<strong>LLM Gateway</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or
				&ldquo;us&rdquo;), a service of <strong>Polar Lights LLC</strong>, 16192
				Coastal Highway, Lewes, DE 19958, United States. These Airside
				Supplemental Terms of Use (&ldquo;Airside Terms&rdquo;) govern your
				access to and use of Airside, including the website at{" "}
				<a href="https://airside.llmgateway.io">airside.llmgateway.io</a>, the
				Airside console, and related APIs (collectively, the
				&ldquo;Service&rdquo;).
			</p>
			<p>
				<strong>
					These Airside Terms are an addendum to, and incorporate by reference,
					the main{" "}
					<a href="https://llmgateway.io/legal/terms">
						LLM Gateway Terms of Use
					</a>{" "}
					(the &ldquo;Base Terms&rdquo;), which form the base agreement between
					you and us.
				</strong>{" "}
				The Base Terms apply in full and govern all topics not specifically
				addressed here — including eligibility, accounts and security,
				intellectual property, disclaimers, limitation of liability,
				indemnification, dispute resolution and arbitration, and governing law.
				These Airside Terms only add to or modify the Base Terms for the
				carrier-specific points below.
			</p>
			<p>
				<strong>Order of precedence.</strong> If there is a direct conflict
				between these Airside Terms and the Base Terms with respect to Airside,
				these Airside Terms control for that conflict only. If you and we have
				signed a separate written provider, partner, or revenue-share agreement,
				that agreement controls over both, as described in Section&nbsp;16 of
				the Base Terms. Capitalized terms not defined here have the meaning
				given in the Base Terms.
			</p>
			<p>
				By accessing or using Airside, you agree to be bound by both the Base
				Terms and these Airside Terms. If you do not agree, please discontinue
				use immediately.
			</p>
			<hr />

			<h2>1. What Airside Is</h2>
			<p>
				Airside is the self-serve console where an AI model provider (a
				&ldquo;carrier&rdquo;) lists its models on LLM Gateway and manages how
				they are routed. Through Airside you can:
			</p>
			<ul>
				<li>
					Claim an existing provider in our catalogue, or register a new
					provider whose OpenAI-compatible endpoint is served from your own
					domain
				</li>
				<li>
					List models with their context window, capabilities, and rate limits
				</li>
				<li>
					File pricing (&ldquo;tariff filings&rdquo;) for review and approval
				</li>
				<li>
					Set a routing discount and the gateway margin you accept, which feed
					our routing selection
				</li>
				<li>View aggregated usage of your listed models</li>
			</ul>
			<p>
				Airside is an operational console, not a marketplace listing agreement,
				a reseller appointment, or a guarantee of demand. It does not create an
				exclusive relationship, a joint venture, a partnership, or an agency
				relationship between you and us.
			</p>
			<hr />

			<h2>2. Carrier Claims and Domain Verification</h2>
			<p>
				A claim is authorized by <strong>email domain control</strong>. You may
				file a claim only from a verified email address whose registrable domain
				matches the registrable domain of the provider&rsquo;s API endpoint or
				published website. Free and disposable email domains are rejected. This
				check is enforced server-side; the interface is a convenience, not the
				control.
			</p>
			<p>
				<strong>Claims are reviewed before they take effect.</strong> A filed
				claim is <em>pending</em> until we approve it. We may approve, reject,
				or later revoke any claim at our discretion, including where we believe
				the claimant does not in fact control the provider, where a claim would
				shadow an existing catalogue entry, or where required by law. Only one
				live claim may exist per provider at a time.
			</p>
			<p>
				You represent and warrant that you are authorized to act for the
				provider you claim, and that listing its models through LLM Gateway does
				not breach any agreement or third-party right. Domain control is
				evidence of authority, not a substitute for it — if you lose that
				authority, you must stop using Airside for that carrier and notify us.
			</p>
			<p>
				<strong>Branding.</strong> By uploading a logo or icon you grant us a
				non-exclusive, worldwide, royalty-free licence to display those marks
				and your provider name on LLM Gateway surfaces (including public
				catalogue, provider, and model pages) for the purpose of operating and
				marketing the Service. You represent that you hold the rights to grant
				that licence. You may update or remove your marks at any time from the
				console; removal takes effect on our public pages after normal cache
				expiry.
			</p>
			<hr />

			<h2>3. Listing Fee</h2>
			<p>
				Where a listing fee is configured on the deployment you use, activating
				a carrier requires a <strong>one-time listing fee</strong>, charged
				through <strong>Stripe</strong> and payable per provider company before
				a claim can be approved. The fee covers review and onboarding. It is{" "}
				<strong>non-refundable</strong> except where required by law, including
				where a claim is later rejected or revoked, and it does not entitle you
				to approval, to any level of traffic, or to any minimum revenue.
			</p>
			<p>
				We may waive the fee at our discretion, including through invite codes
				we issue to providers we already work with. A waived fee confers the
				same rights, and no more, than a paid one.
			</p>
			<p>
				Self-hosted and non-commercial deployments of LLM Gateway may run
				without a listing fee configured; in that case no fee is charged and
				this section does not apply.
			</p>
			<hr />

			<h2>4. Fleet Listings and Tariff Filings</h2>
			<p>
				<strong>Prices are the part you cannot change silently.</strong> The
				price you file is the price developers are billed for requests routed to
				your models, so pricing enters service only through an approved filing:
			</p>
			<ul>
				<li>
					Adding a model creates a <em>draft</em> listing plus an{" "}
					<strong>initial filing</strong>. The model does not enter service
					until that filing is approved.
				</li>
				<li>
					Changing a price creates an <strong>update filing</strong>. The
					previously approved price stays in effect until the new filing is
					approved. Only one filing may be pending per model at a time.
				</li>
				<li>
					Every other attribute — display name, description, context window,
					capabilities, rate limits — you may edit directly, and changes to a
					live listing are mirrored into the catalogue without review.
				</li>
			</ul>
			<p>
				We may reject any filing or listing, with or without a stated reason,
				including for inaccurate capability claims, pricing we cannot bill
				correctly, or a model we are not willing to carry. Approval of a filing
				is an operational decision about listing it on our platform. It is not
				an endorsement, a certification of your model, or a representation to
				developers about its quality or safety.
			</p>
			<p>
				<strong>Accuracy is your obligation.</strong> You are responsible for
				the accuracy of everything you list. Capability flags in particular
				drive routing: declaring support for vision, tools, structured output,
				or reasoning that your deployment does not actually honour causes failed
				requests billed to developers. Repeatedly inaccurate listings are
				grounds for delisting under Section&nbsp;7.
			</p>
			<p>
				<strong>Availability.</strong> You are responsible for operating the
				endpoint behind your listings, for its uptime and capacity, and for
				complying with your own upstream licences and model providers&rsquo;
				terms. Set the request-rate caps on each listing to values your
				infrastructure can actually serve; we may apply our own caps in
				addition, and ours take precedence.
			</p>
			<hr />

			<h2>5. Dispatch, Routing, and Traffic</h2>
			<p>
				This section supplements Section&nbsp;7 of the Base Terms. Requests are
				routed by an automatic selection among eligible providers, scored on
				price (after your discount and the gateway margin you accept),
				availability, throughput, and latency.
			</p>
			<p>
				<strong>
					We do not guarantee any volume of traffic, revenue, ranking, or
					placement.
				</strong>{" "}
				We may change routing scores, weights, preferences, eligibility rules,
				and similar routing parameters at any time and at our discretion,
				including in ways that reduce traffic to your models. Developers may
				also pin a specific provider, disable fallback, or exclude providers,
				which overrides automatic selection entirely.
			</p>
			<p>
				Changes to the discount and margin controls in the console are filed for
				review, like tariff filings, and take effect only once we approve them;
				your previously effective values remain in force until then. Approved
				changes apply prospectively to requests routed after the change. They
				change how your models are scored and what you are paid; they do not
				change prices already billed.
			</p>
			<hr />

			<h2>6. Usage Reporting</h2>
			<p>
				The console reports usage of your claimed providers — requests, errors,
				tokens, and billed traffic — aggregated across all gateway tenants who
				route to you. This aggregate deliberately excludes the identity of the
				organizations, projects, and end users generating that traffic, and you
				must not attempt to re-identify them.
			</p>
			<p>
				<strong>
					The console reports traffic, not amounts owed, and is neither a
					statement of account nor a promise to pay.
				</strong>{" "}
				Whether any amount is payable, on what schedule, in what currency,
				subject to what minimum, and against what documentation is governed
				solely by a separate written agreement between you and us. In the
				absence of such an agreement, no payment obligation arises from these
				Airside Terms or from any figure shown in the console.
			</p>
			<p>
				Usage figures are derived from our own metering and rollups and may lag
				real time or be restated. Where our records and yours disagree, ours
				control for the operation of the Service, without prejudice to any
				reconciliation process in a signed agreement.
			</p>
			<hr />

			<h2>7. Suspension, Delisting, and Revocation</h2>
			<p>
				You may delist any model at any time from the console. Delisting removes
				it from routing; it does not affect requests already served or amounts
				already billed.
			</p>
			<p>
				We may suspend, delist, or revoke a listing, a claim, or your access to
				Airside — with notice where practicable, and without prior notice where
				the issue is urgent — if:
			</p>
			<ul>
				<li>
					The endpoint is unavailable, unreliable, or fails a materially high
					share of requests
				</li>
				<li>
					A listing misstates pricing, capabilities, or the identity of the
					underlying model
				</li>
				<li>
					You no longer control the domain or the provider on which the claim
					was based
				</li>
				<li>
					The listing, or the model behind it, violates the Base Terms&rsquo;
					acceptable use rules or applicable law, or infringes a third-party
					right
				</li>
				<li>Required by law, by a court, or by an upstream rightsholder</li>
			</ul>
			<p>
				Revocation removes your listings from routing and from the public
				catalogue. It does not by itself entitle you to a refund of the listing
				fee.
			</p>
			<hr />

			<h2>8. Data and Privacy</h2>
			<p>
				Our handling of carrier account and listing data is described in the{" "}
				<a href="/legal/privacy">Airside Supplemental Privacy Notice</a> and the
				main{" "}
				<a href="https://llmgateway.io/legal/privacy">
					LLM Gateway Privacy Policy
				</a>
				.
			</p>
			<p>
				When we route a request to your endpoint, you receive the request
				content and act as an independent controller of the personal data it may
				contain. You must handle it in accordance with applicable data
				protection law and with the data-handling representations you publish,
				including any statements about training on API data, prompt logging, and
				retention that we surface on our{" "}
				<a href="https://llmgateway.io/legal/providers">
					provider information page
				</a>
				. Those published representations must be accurate and kept current;
				developers rely on them to choose a provider.
			</p>
			<hr />

			<h2>9. Changes to These Terms</h2>
			<p>
				We may update these Airside Terms as the Service changes, as described
				in Section&nbsp;17 of the Base Terms. Material changes affecting
				carriers will be reflected in the &ldquo;Last Updated&rdquo; date above.
				Continuing to use Airside after an update means you accept the revised
				terms.
			</p>
			<hr />

			<h2>10. Contact</h2>
			<p>
				Questions about these Airside Terms, a claim, or a filing:{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>
			</p>
			<p>
				Polar Lights LLC
				<br />
				16192 Coastal Highway
				<br />
				Lewes, DE 19958
				<br />
				United States
			</p>
		</>
	);
}
