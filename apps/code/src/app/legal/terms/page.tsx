import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Use — DevPass",
	description:
		"Review the Terms of Use for DevPass. Learn about account eligibility, billing, fair-use limits, AI provider policies, and developer responsibilities when using our flat-rate AI coding subscription.",
	alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
	return (
		<>
			<h1>Terms of Use</h1>
			<p>
				<strong>Effective Date:</strong> April 26, 2026
				<br />
				<strong>Last Updated:</strong> May 26, 2026
			</p>
			<p>
				Welcome to <strong>DevPass</strong>, a service operated by{" "}
				<strong>LLM Gateway</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or
				&ldquo;us&rdquo;). These Terms of Use (&ldquo;Terms&rdquo;) govern your
				access to and use of DevPass, including the website at{" "}
				<a href="https://devpass.llmgateway.io">devpass.llmgateway.io</a>, the
				DevPass dashboard, related APIs, SDKs, and any DevPass-branded products
				or services (collectively, the &ldquo;Service&rdquo;).
			</p>
			<p>
				By accessing or using the Service, you agree to be bound by these Terms.
				If you do not agree, please discontinue use immediately.
			</p>
			<hr />
			<h2>1. Overview</h2>
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
				the economics of the Service and is prohibited under Section&nbsp;7.
				Embeddings, image generation, and video generation are not included in
				DevPass and are blocked at the gateway. If you need API access for an
				application or for non-inference workloads (such as embeddings, image
				generation, or video generation), use a standard LLM Gateway credits
				plan instead.
			</p>
			<hr />
			<h2>2. Eligibility</h2>
			<p>You must:</p>
			<ul>
				<li>
					Be at least 16 years old (or the age of digital consent in your
					country)
				</li>
				<li>Have the legal authority to enter into these Terms</li>
				<li>Use the Service in compliance with applicable laws</li>
			</ul>
			<p>
				If you use DevPass on behalf of an employer or organization, you
				represent that you are authorized to bind that organization.
			</p>
			<hr />
			<h2>3. Accounts and Access</h2>
			<p>You must create an account to use DevPass. You are responsible for:</p>
			<ul>
				<li>Maintaining the confidentiality of your API key and credentials</li>
				<li>All activity that occurs under your account or API key</li>
				<li>Ensuring your account information is accurate and current</li>
			</ul>
			<p>
				Notify us immediately at{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a> of any
				unauthorized access or suspected key compromise.
			</p>
			<hr />
			<h2>4. Plans, Billing, and Fair Use</h2>
			<p>DevPass is sold as a tiered monthly subscription:</p>
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
				Billing is processed securely through <strong>Stripe</strong>. By
				subscribing, you authorize us to charge your payment method for the
				selected plan and any applicable taxes.
			</p>
			<p>
				All fees are non-refundable except where required by law. You may cancel
				at any time; your plan remains active until the end of the current
				billing period.
			</p>
			<p>
				DevPass is intended for individual developer use. We may rate-limit,
				suspend, or downgrade accounts that show signs of automated abuse, key
				sharing, resale, or sustained traffic patterns inconsistent with
				interactive coding workflows.
			</p>
			<hr />
			<h2>5. One Account Per Developer</h2>
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
			<h2>6. Data and Privacy</h2>
			<p>
				Your data is handled according to our{" "}
				<Link href="/legal/privacy">Privacy Policy</Link>. Request payloads,
				responses, and per-agent metadata are stored to power your dashboard,
				usage reporting, and per-tool insights, subject to the retention options
				available in your account settings.
			</p>
			<hr />
			<h2>7. Acceptable Use</h2>
			<p>You agree not to:</p>
			<ul>
				<li>
					Use the Service to generate or distribute illegal, harmful, or
					infringing content
				</li>
				<li>
					Resell, redistribute, or proxy the Service without written permission
				</li>
				<li>
					Share API keys outside your organization or use a single key from
					unrelated parties
				</li>
				<li>
					Attempt to circumvent rate limits, plan allowances, or authentication
					controls
				</li>
				<li>
					Open multiple DevPass accounts or otherwise abuse the included usage
					allowance as described in Section&nbsp;5
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
				<li>Probe, scan, or attack the platform or any connected provider</li>
			</ul>
			<p>
				We reserve the right to <strong>permanently ban</strong> accounts — and
				every related account — that engage in abuse, fraud, payment disputes
				filed in bad faith, or any other policy violation, including
				provider-level violations. Banned accounts lose access immediately; fees
				paid for the current billing cycle are not refunded.
			</p>
			<hr />
			<h2>8. AI Provider Usage</h2>
			<p>
				When you use AI models through DevPass, you are also subject to the
				terms and acceptable-use policies of the underlying providers (such as
				Anthropic, OpenAI, Google, Mistral, DeepSeek, and others). DevPass
				routes and meters traffic — we do not control provider model behavior
				and we are not liable for provider outages or model output quality.
			</p>
			<hr />
			<h2>9. Intellectual Property</h2>
			<p>
				All rights in DevPass and LLM Gateway (software, design, and branding)
				are owned by us or our licensors. You retain ownership of your prompts
				and generated outputs. You grant us a limited license to process your
				data solely to provide and improve the Service.
			</p>
			<hr />
			<h2>10. Termination &amp; Bans</h2>
			<p>
				You can cancel anytime from the dashboard. We may suspend, terminate, or
				permanently ban your account — and any related accounts — if you violate
				these Terms (including Sections&nbsp;5 and&nbsp;7), misuse the Service,
				dispute legitimate charges, or as required by law. Bans take effect
				immediately and do not require prior notice. On termination, access
				ceases, active subscriptions are cancelled, and stored data is deleted
				according to your retention settings.
			</p>
			<hr />
			<h2>11. Disclaimers</h2>
			<p>
				The Service is provided <strong>&ldquo;as is&rdquo;</strong> and{" "}
				<strong>&ldquo;as available&rdquo;</strong> without warranties of any
				kind. We do not guarantee that the Service will be error-free,
				uninterrupted, or that AI outputs will be accurate, safe, or fit for a
				particular purpose. You are responsible for reviewing AI-generated code
				before relying on it.
			</p>
			<hr />
			<h2>12. Limitation of Liability</h2>
			<p>To the fullest extent permitted by law:</p>
			<ul>
				<li>
					DevPass is not liable for indirect, incidental, special, or
					consequential damages
				</li>
				<li>
					Our total liability for any claim arising from these Terms shall not
					exceed the amount you paid to us in the preceding{" "}
					<strong>three (3) months</strong>
				</li>
			</ul>
			<hr />
			<h2>13. Indemnification</h2>
			<p>
				You agree to indemnify and hold harmless LLM Gateway and DevPass, our
				founders, employees, and partners from any claims, damages, or expenses
				arising from your use or misuse of the Service or violation of these
				Terms or third-party rights.
			</p>
			<hr />
			<h2>14. Changes to These Terms</h2>
			<p>
				We may update these Terms from time to time. The latest version will
				always be available at{" "}
				<a href="https://devpass.llmgateway.io/legal/terms">
					devpass.llmgateway.io/legal/terms
				</a>
				. Material changes will be communicated by email or in-app notice.
				Continued use after changes constitutes acceptance of the updated Terms.
			</p>
			<hr />
			<h2>15. Governing Law</h2>
			<p>
				These Terms are governed by the laws of <strong>Delaware, USA</strong>,
				without regard to conflict-of-laws principles. Disputes will be resolved
				in the state or federal courts located in Delaware.
			</p>
			<hr />
			<h2>16. Contact</h2>
			<p>
				Questions about these Terms? Email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>.
			</p>
			<p>© 2026 LLM Gateway. All rights reserved.</p>
		</>
	);
}
