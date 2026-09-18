import Link from "next/link";

import { LegalSummary } from "@/components/LegalSummary";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Use",
	description:
		"Supplemental DevPass Terms of Use for the flat-rate subscription: fair-use limits, one account per developer, approved coding tools, and AI provider policies. Coding-agent-only scope applies from October 15, 2026.",
	alternates: { canonical: "/legal/terms" },
	openGraph: {
		title: "DevPass Supplemental Terms of Use",
		description:
			"The terms that govern the DevPass flat-rate subscription, on top of the LLM Gateway Terms of Use.",
		type: "article",
		url: "https://devpass.llmgateway.io/legal/terms",
	},
};

export default function TermsPage() {
	return (
		<>
			<h1>DevPass Supplemental Terms of Use</h1>
			<p>
				<strong>Effective Date:</strong> April 26, 2026
				<br />
				<strong>Last Updated:</strong> September 16, 2026
			</p>
			<LegalSummary variant="terms" />
			<p>
				<strong>DevPass</strong> is a service operated by{" "}
				<strong>LLM Gateway</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or
				&ldquo;us&rdquo;), a service of <strong>Polar Lights LLC</strong>, 16192
				Coastal Highway, Lewes, DE 19958, United States. These DevPass
				Supplemental Terms of Use (&ldquo;DevPass Terms&rdquo;) govern your
				access to and use of DevPass, including the website at{" "}
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
			<p>
				<strong>
					Scope change effective October&nbsp;15, 2026 &mdash; coding agents
					only.
				</strong>{" "}
				This paragraph does not apply today. It takes effect on October&nbsp;15,
				2026 and then applies only to DevPass billing periods that begin on or
				after that date; a billing period that started earlier stays governed by
				the paragraph above until your next renewal. From then on, DevPass is
				licensed solely for software development work carried out interactively
				through an approved coding agent or coding tool. It is{" "}
				<strong>not</strong> a general-purpose API and <strong>not</strong> a
				general-purpose AI assistant. Two categories of usage are excluded.
				First, <strong>API and automation usage</strong>: you may not use your
				DevPass API key to power your own applications, products, services,
				backends, scripts, cron jobs, batch pipelines, bots, or any other direct
				or automated API integration, whether or not a coding agent is involved.
				Second, <strong>non-coding usage</strong>: you may not use DevPass for
				purposes unrelated to software development &mdash; by way of example
				only, and without limitation, role play, companion or character chat,
				creative and fiction writing, general-purpose chat and
				question-answering, research and summarization, translation, marketing
				or SEO content generation, dataset generation, synthetic data, model
				distillation, evaluations, and benchmarking.{" "}
				<strong>
					These examples are illustrative and are not an exhaustive list.
				</strong>{" "}
				Any use that is not interactive software development through an approved
				coding tool is outside the scope of DevPass from that date, even if it
				is not named here, and we determine in our reasonable discretion whether
				a given usage pattern qualifies.
			</p>
			<p>
				<strong>Automatic routing.</strong> When DevPass selects a provider
				automatically, we may change internal routing scores, weights,
				preferences, and similar routing parameters at any time and at our
				discretion. As described in Section&nbsp;7 of the Base Terms, these
				parameters affect provider selection but do not themselves change the
				price used to measure usage. If you require a particular provider, you
				must pin that provider where the Service supports provider pinning.
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
					<strong>do not roll over</strong> at renewal; the only exception is an
					immediate mid-cycle upgrade, which rolls your unused allowance into
					the new cycle (see &ldquo;Plan changes&rdquo; below)
				</li>
			</ul>
			<p>
				Billing is processed securely through <strong>Stripe</strong>, as
				described in the Base Terms. By subscribing, you authorize us to charge
				your payment method for the selected plan and any applicable taxes.
				Subscriptions renew automatically each month until cancelled. All fees
				are generally non-refundable except where required by law or under the
				limited goodwill refund option below. You may cancel at any time; your
				plan remains active until the end of the current billing period.
			</p>
			<p>
				<strong>Limited first-month goodwill refund.</strong> Once you start
				using your included allowance, you are not entitled to a refund because
				each processed request causes us to incur real, non-recoverable AI
				provider costs. As a limited goodwill exception, we may make a full
				self-service refund available for your initial DevPass plan payment if
				you request it from your billing dashboard within 14 days of purchase
				and have used less than 20% of the monthly allowance. The payment and
				account must also meet the eligibility requirements shown in the billing
				dashboard. Once usage reaches 20% or more, a refund is not available.
				Any reference to a &ldquo;first-month guarantee&rdquo; means only this
				limited goodwill option and does not create a broader right to a refund.
			</p>
			<p>
				If the refund option is available, select <strong>Refund</strong> on the
				eligible charge in your billing dashboard. An approved refund ends your
				DevPass subscription and access immediately, and any unused allowance
				for that billing period is forfeited. There is no cancellation fee.
			</p>
			<p>
				<strong>Plan changes.</strong> You may change tiers at any time from
				your dashboard. <strong>Upgrades</strong> take effect immediately by
				default: we charge the full price of the new tier at the time of the
				upgrade, your billing cycle restarts on that day, and you receive the
				new tier&rsquo;s full monthly allowance. Any unused allowance from the
				cycle being replaced <strong>rolls over</strong> into the new
				cycle&rsquo;s allowance; rolled-over allowance expires at your next
				renewal and is not refunded, credited, or deducted from the upgrade
				price. You may instead schedule an upgrade for your next renewal: no
				charge is due when scheduling, you keep your current tier and allowance
				until the renewal, and the new tier is billed from the renewal onward
				(no allowance rolls over at renewal). <strong>Downgrades</strong> are
				scheduled for your next renewal: you keep your current tier and its
				allowance until the end of the period you have already paid for, the
				lower tier is billed from the next renewal onward, and no charge or
				refund is issued when you schedule the downgrade.
			</p>
			<p>
				DevPass is intended for private, personal use by an individual developer
				— not for teams, companies, or other organizations (see Section&nbsp;3).
				We may rate-limit, suspend, or downgrade accounts that show signs of
				automated abuse, key sharing, resale, or sustained traffic patterns
				inconsistent with interactive coding workflows.
			</p>
			<h3 id="october-2026-plan-changes">Plan changes from October 15, 2026</h3>
			<p>
				These changes apply to both new and existing subscribers. Subscription
				prices stay the same, but included usage decreases. If you subscribe
				before October 15, 2026, your initial monthly allowance is 3&times; your
				plan price. It becomes 2&times; at your first renewal on or after that
				date. New subscriptions and new billing cycles started by an immediate
				upgrade on or after that date receive the 2&times; allowance, subject to
				the upgrade rollover rule above.
			</p>
			<p>
				Daily and weekly limits and Reset Pass changes take effect on October
				15, 2026, including during a billing cycle that started earlier. The
				percentages below use the new standard monthly allowance for your tier,
				even if your current cycle still has its earlier monthly allowance. Pro
				no longer includes a free Reset Pass; Max continues to include two per
				billing cycle.
			</p>
			<div className="overflow-x-auto">
				<table className="w-full text-left [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-border">
					<caption className="mb-3 text-left font-medium text-foreground">
						DevPass allowances and Reset Pass benefits from October 15, 2026
					</caption>
					<thead>
						<tr>
							<th scope="col">Benefit or limit</th>
							<th scope="col">Lite</th>
							<th scope="col">Pro</th>
							<th scope="col">Max</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<th scope="row">
								Standard monthly allowance (provider-rate usage)
							</th>
							<td>$58</td>
							<td>$158</td>
							<td>$358</td>
						</tr>
						<tr>
							<th scope="row">
								Daily cap across all models (rolling 24 hours)
							</th>
							<td>8%</td>
							<td>9%</td>
							<td>10%</td>
						</tr>
						<tr>
							<th scope="row">Premium weekly cap</th>
							<td>10%</td>
							<td>12%</td>
							<td>15%</td>
						</tr>
						<tr>
							<th scope="row">Price per Reset Pass</th>
							<td>$5</td>
							<td>$15</td>
							<td>$45</td>
						</tr>
						<tr>
							<th scope="row">Included Reset Passes per billing cycle</th>
							<td>0</td>
							<td>0</td>
							<td>2</td>
						</tr>
					</tbody>
				</table>
			</div>
			<p>
				Daily and premium weekly caps limit how quickly you can use your monthly
				allowance; they are not additional usage. A Reset Pass restores only the
				premium weekly allowance and does not reset or increase your daily or
				monthly allowance. At a daily or premium weekly cap, requests pause
				unless you have opted into pay-as-you-go overflow and have available
				credits. Overflow is billed separately from your subscription and is not
				enabled by accepting these terms.
			</p>
			<p>
				Review these changes before subscribing. You may change plans or cancel
				in your&nbsp;<Link href="/dashboard/billing">billing dashboard</Link>.
				To avoid a renewal under the new monthly allowance, cancel before your
				next renewal on or after October 15, 2026. Cancellation stops future
				renewal charges; access continues until the end of the paid billing
				period and remains subject to the limits effective during that period.
			</p>
			<hr />
			<h2>3. One Account Per Developer</h2>
			<p>
				DevPass is sold to <strong>one developer, on one account</strong>. The
				flat-rate price and included usage allowance only work because each
				person uses a single account in good faith. Splitting that usage across
				multiple accounts is the fastest way to break the deal for everyone.
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
				<strong>No team or company use.</strong> DevPass is intended for
				private, personal, individual use only. It may not be purchased, shared,
				expensed, or otherwise used by or on behalf of a team, company, or other
				organization, and we do not offer team or multi-seat DevPass plans. If
				you need AI model access for multiple developers, use our pay-as-you-go
				LLM Gateway product under the Base Terms instead — contact{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a> for
				custom solutions and volume discounts for teams.
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
			<p>
				<strong>
					Additional restriction effective October&nbsp;15, 2026, for new
					billing periods.
				</strong>{" "}
				The restriction and enforcement rules in this paragraph do not apply
				today. They take effect on October&nbsp;15, 2026 and then apply only to
				DevPass billing periods that begin on or after that date. From then on,
				you also agree not to use DevPass for anything other than interactive
				software development, even from an approved tool; excluded uses are
				described in Section&nbsp;1 and that list is illustrative, not
				exhaustive. API, automation, or non-coding usage in a billing period
				covered by this paragraph can get your DevPass account{" "}
				<strong>banned without a refund</strong>. Where the violation is limited
				and appears inadvertent, we may first warn you, rate-limit the account,
				or block the offending traffic. We are not required to do so: depending
				on the scale and nature of the usage we may terminate the subscription
				and permanently ban the account &mdash; together with every related
				account &mdash; immediately and without prior notice, at any point in
				the billing cycle. Fees already paid are retained, no refund or credit
				is issued for the remainder of the cycle or for any unused allowance,
				and the first-month goodwill refund in Section&nbsp;2 does not apply to
				an account terminated for a violation.
			</p>
			<hr />
			<h2>5. Data and Privacy</h2>
			<p>
				Your DevPass data is handled according to the{" "}
				<Link href="/legal/privacy">DevPass Privacy Policy</Link>, which builds
				on the main{" "}
				<a href="https://llmgateway.io/privacy">LLM Gateway Privacy Policy</a>.
				Per-agent metadata — token counts, costs, models, and routing
				information — is stored to power your dashboard, usage reporting, and
				per-tool insights. Request payloads and responses are not retained on
				DevPass, except for stateful Responses API requests, which are stored
				for up to 30 days so response chaining works.
			</p>
			<hr />
			<h2>6. Contact</h2>
			<p>
				Questions about these DevPass Terms or the Base Terms? Email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>.
			</p>
			<p>
				<strong>LLM Gateway</strong>
				<br />
				on behalf of
			</p>
			<p>
				<strong>Polar Lights LLC</strong>
				<br />
				16192 Coastal Highway
				<br />
				Lewes, DE 19958
				<br />
				United States
			</p>
			<p>© 2026 LLM Gateway. All rights reserved.</p>
		</>
	);
}
