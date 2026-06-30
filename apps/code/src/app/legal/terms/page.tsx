import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Use — DevPass",
	description:
		"Supplemental DevPass Terms of Use. These build on the LLM Gateway Terms of Use and cover the DevPass flat-rate subscription: fair-use limits, one account per developer, approved coding tools, and AI provider policies.",
	alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
	return (
		<>
			<h1>DevPass Supplemental Terms of Use</h1>
			<p>
				<strong>Effective Date:</strong> April 26, 2026
				<br />
				<strong>Last Updated:</strong> June 26, 2026
			</p>
			<p>
				<strong>DevPass</strong> is a service operated by{" "}
				<strong>LLM Gateway</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or
				&ldquo;us&rdquo;). These DevPass Supplemental Terms of Use
				(&ldquo;DevPass Terms&rdquo;) govern your access to and use of DevPass,
				including the website at{" "}
				<a href="https://devpass.llmgateway.io">devpass.llmgateway.io</a>, the
				DevPass dashboard, related APIs, SDKs, and any DevPass-branded products
				or services (collectively, the &ldquo;Service&rdquo;).
			</p>
			<p>
				<strong>
					These DevPass Terms are an addendum to, and incorporate by reference,
					the main{" "}
					<a href="https://llmgateway.io/terms">LLM Gateway Terms of Use</a>{" "}
					(the &ldquo;Base Terms&rdquo;), which form the base agreement between
					you and us.
				</strong>{" "}
				The Base Terms apply in full to your use of DevPass and govern all
				topics not specifically addressed here — including eligibility, accounts
				and security, intellectual property, disclaimers, limitation of
				liability, indemnification, dispute resolution and arbitration, and
				governing law. These DevPass Terms only add to or modify the Base Terms
				for the DevPass-specific points below.
			</p>
			<p>
				<strong>Order of precedence.</strong> If there is a direct conflict
				between these DevPass Terms and the Base Terms with respect to DevPass,
				these DevPass Terms control for that conflict only. In all other
				respects, the Base Terms remain in full force and effect. Capitalized
				terms not defined here have the meaning given in the Base Terms.
			</p>
			<p>
				By accessing or using DevPass, you agree to be bound by both the Base
				Terms and these DevPass Terms. If you do not agree, please discontinue
				use immediately.
			</p>
			<hr />
			<h2>1. What DevPass Is</h2>
			<p>
				DevPass is a flat-rate subscription that gives developers access to 200+
				AI coding models through a single OpenAI-compatible API endpoint and the
				LLM Gateway. The Service allows you to:
			</p>
			<ul>
				<li>
					Route AI requests to providers such as Anthropic, OpenAI, Google,
					Mistral, DeepSeek, and others through approved coding and agent tools
					like Claude Code, Codex, Cursor, Cline, OpenCode, OpenClaw, Hermes,
					and Autohand
				</li>
				<li>
					Track usage, costs, and per-agent activity in your DevPass dashboard
				</li>
				<li>Manage a single API key shared across every supported tool</li>
			</ul>
			<p>
				DevPass is licensed solely for interactive use through approved coding
				and agent tools. It is <strong>not</strong> a general-purpose API: you
				may not use your DevPass API key to power your own applications,
				products, services, backends, scripts, batch jobs, or any other direct
				API integration. The flat-rate pricing assumes interactive,
				human-in-the-loop usage from a whitelisted tool — any other usage breaks
				the economics of the Service and is prohibited under Section&nbsp;4.
				Embeddings, image generation, and video generation are not included in
				DevPass and are blocked at the gateway. If you need API access for an
				application or for non-inference workloads (such as embeddings, image
				generation, or video generation), use a standard LLM Gateway credits
				plan under the Base Terms instead.
			</p>
			<hr />
			<h2>2. Plans, Billing, and Fair Use</h2>
			<p>
				This section supplements Section&nbsp;4 (Plans, Credits, and Billing) of
				the Base Terms. DevPass is sold as a tiered monthly subscription:
			</p>
			<ul>
				<li>
					<strong>Lite, Pro, and Max</strong> tiers each include a monthly
					model-usage allowance, denominated in dollars of provider cost
				</li>
				<li>
					Allowances reset at the start of each billing cycle and{" "}
					<strong>do not roll over</strong>
				</li>
			</ul>
			<p>
				Billing is processed securely through <strong>Stripe</strong>, as
				described in the Base Terms. By subscribing, you authorize us to charge
				your payment method for the selected plan and any applicable taxes. All
				fees are non-refundable except where required by law. You may cancel at
				any time; your plan remains active until the end of the current billing
				period.
			</p>
			<p>
				DevPass is intended for individual developer use. We may rate-limit,
				suspend, or downgrade accounts that show signs of automated abuse, key
				sharing, resale, or sustained traffic patterns inconsistent with
				interactive coding workflows.
			</p>
			<hr />
			<h2>3. One Account Per Developer</h2>
			<p>
				DevPass is sold to <strong>one developer, on one account</strong>. The
				flat-rate price and{" "}
				<strong>3&times; your subscription in included usage</strong> only work
				because each person uses a single account in good faith. Splitting that
				usage across multiple accounts is the fastest way to break the deal for
				everyone.
			</p>
			<p>
				To keep the pricing sustainable for the developers who use DevPass
				honestly, the following are <strong>not allowed</strong>:
			</p>
			<ul>
				<li>
					Creating more than one DevPass account per person, household, or
					business entity
				</li>
				<li>
					Reusing the same payment card, billing address, device, or IP across
					multiple DevPass accounts to claim the included usage more than once
				</li>
				<li>
					Cancelling and re-subscribing under a new account to reset usage
					before the billing cycle renews
				</li>
				<li>
					Using prepaid cards, virtual cards, or other payment instruments
					designed to obscure identity for the purpose of opening additional
					accounts
				</li>
			</ul>
			<p>
				We automatically check the payment card used at checkout against
				existing DevPass subscriptions. If the same card has already been used
				to activate DevPass on another account, the new subscription is
				cancelled and access is not granted.
			</p>
			<p>
				If we detect (manually or automatically) that the rules in this section
				have been broken, we may, <strong>without prior notice</strong>:
			</p>
			<ul>
				<li>
					Cancel every active subscription on every related account immediately,
					at any point in the billing cycle
				</li>
				<li>
					Revoke API keys and block gateway access for every related account
				</li>
				<li>
					Refuse any future signup associated with the same person, card, or
					organization
				</li>
				<li>
					Retain fees already paid for the cycle in progress, since the included
					usage has already been provisioned
				</li>
			</ul>
			<p>
				If you genuinely need DevPass for multiple developers (for example, a
				team or company), contact{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a> before
				signing up. We offer team plans that let multiple developers share
				DevPass legitimately.
			</p>
			<hr />
			<h2>4. DevPass Acceptable Use</h2>
			<p>
				In addition to the Acceptable Use rules in Section&nbsp;6 of the Base
				Terms, the following DevPass-specific restrictions apply. You agree not
				to:
			</p>
			<ul>
				<li>
					Open multiple DevPass accounts or otherwise abuse the included usage
					allowance as described in Section&nbsp;3
				</li>
				<li>
					Use your DevPass API key directly from your own applications,
					backends, products, services, scripts, batch pipelines, or any other
					integration outside of an approved coding or agent tool. DevPass is
					only usable from whitelisted clients such as Claude Code, Codex,
					Cursor, Cline, OpenCode, OpenClaw, Hermes, and Autohand. The list of
					approved tools is maintained at our discretion and may change over
					time
				</li>
				<li>
					Use DevPass for non-inference workloads — embeddings, image
					generation, and video generation are not included and are blocked at
					the gateway. Use a standard LLM Gateway credits plan for those use
					cases
				</li>
				<li>
					Share your DevPass API key outside your own use or use a single key
					across unrelated parties
				</li>
				<li>
					Attempt to circumvent rate limits, plan allowances, or authentication
					controls
				</li>
			</ul>
			<p>
				We reserve the right to <strong>permanently ban</strong> accounts — and
				every related account — that engage in abuse, fraud, payment disputes
				filed in bad faith, or any other policy violation, including
				provider-level violations. Banned accounts lose access immediately; fees
				paid for the current billing cycle are not refunded. This supplements
				the suspension and termination rights in Section&nbsp;11 of the Base
				Terms.
			</p>
			<hr />
			<h2>5. Data and Privacy</h2>
			<p>
				Your DevPass data is handled according to the{" "}
				<Link href="/legal/privacy">DevPass Privacy Policy</Link>, which builds
				on the main{" "}
				<a href="https://llmgateway.io/privacy">LLM Gateway Privacy Policy</a>.
				Request payloads, responses, and per-agent metadata are stored to power
				your dashboard, usage reporting, and per-tool insights, subject to the
				retention options available in your account settings.
			</p>
			<hr />
			<h2>6. Contact</h2>
			<p>
				Questions about these DevPass Terms or the Base Terms? Email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>.
			</p>
			<p>© 2026 LLM Gateway. All rights reserved.</p>
		</>
	);
}
