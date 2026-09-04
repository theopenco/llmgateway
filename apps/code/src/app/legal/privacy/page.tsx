import { LegalSummary } from "@/components/LegalSummary";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Policy",
	description:
		"Supplemental DevPass Privacy Policy covering request retention, per-agent metadata, AI provider routing, and sub-processors, on top of the LLM Gateway policy.",
	alternates: { canonical: "/legal/privacy" },
	openGraph: {
		title: "DevPass Supplemental Privacy Policy",
		description:
			"How DevPass handles request retention, per-agent metadata, AI provider routing, and sub-processors.",
		type: "article",
		url: "https://devpass.llmgateway.io/legal/privacy",
	},
};

export default function PrivacyPage() {
	return (
		<>
			<h1>DevPass Supplemental Privacy Policy</h1>
			<p>
				<strong>Effective Date:</strong> April 26, 2026
				<br />
				<strong>Last Updated:</strong> August 20, 2026
			</p>
			<LegalSummary variant="privacy" />
			<p>
				This Supplemental Privacy Policy describes how{" "}
				<strong>LLM Gateway</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or
				&ldquo;us&rdquo;) collects, uses, and protects information when you use{" "}
				<strong>DevPass</strong>, our flat-rate subscription for AI coding
				tools, available at{" "}
				<a href="https://devpass.llmgateway.io">devpass.llmgateway.io</a>.
			</p>
			<p>
				<strong>
					This DevPass Privacy Policy is an addendum to, and incorporates by
					reference, the main{" "}
					<a href="https://llmgateway.io/privacy">LLM Gateway Privacy Policy</a>{" "}
					(the &ldquo;Base Policy&rdquo;), which forms the base of how we handle
					your data.
				</strong>{" "}
				The Base Policy applies in full to DevPass and governs all topics not
				specifically addressed here — including our role as controller and
				processor, legal bases for processing, your privacy rights (GDPR,
				UK&nbsp;GDPR, CCPA/CPRA), security, international transfers, and
				children&rsquo;s privacy. This DevPass Privacy Policy only adds DevPass-
				specific detail to the Base Policy.
			</p>
			<p>
				<strong>Order of precedence.</strong> If there is a direct conflict
				between this DevPass Privacy Policy and the Base Policy with respect to
				DevPass, this DevPass Privacy Policy controls for that conflict only. In
				all other respects, the Base Policy remains in full force and effect.
			</p>
			<hr />
			<h2>1. Information We Collect</h2>
			<h3>a. Account Information</h3>
			<p>
				When you sign up, we collect your <strong>name</strong>,{" "}
				<strong>email address</strong>, and authentication credentials. For paid
				plans, we also collect billing details (company name, country, payment
				method) processed securely through <strong>Stripe</strong>.
			</p>
			<p>
				Your DevPass API key secret is shown only when it is created or rolled.
				We retain a keyed one-way hash and masked preview; authentication hashes
				the secret you present and compares the result. Previously issued keys
				remain valid and move to hash-only storage when rolled.
			</p>
			<h3>b. Usage and Request Data</h3>
			<p>
				We log technical metadata for every request routed through DevPass,
				including:
			</p>
			<ul>
				<li>
					Request and response timestamps, latency, finish reasons, and HTTP
					status codes
				</li>
				<li>
					Token counts (prompt, completion, cached, reasoning) and computed cost
				</li>
				<li>
					The model and provider used, the routing tier, and the source coding
					tool (Claude Code, Cursor, Cline, OpenCode, Codex, Autohand, etc.)
				</li>
				<li>IP address, user agent, and approximate region</li>
			</ul>
			<p>
				DevPass is <strong>metadata only</strong>: we keep the counts, costs,
				and routing information listed above, and full request and response{" "}
				<strong>payloads</strong> (your prompts and the model output) are not
				retained in your DevPass logs or dashboard. There is no setting to turn
				payload storage on, on any DevPass plan — the configurable data
				retention available on pay-as-you-go LLM Gateway organizations does not
				apply to DevPass.
			</p>
			<p>
				<strong>Exception — the Responses API.</strong> Requests to{" "}
				<code>/v1/responses</code> (used by tools such as Codex CLI) are
				stateful by design: so that <code>previous_response_id</code> chaining
				and <code>GET /v1/responses/&#123;id&#125;</code> work, the input and
				output items of those requests are held in dedicated storage for up to{" "}
				<strong>30 days</strong>, after which they are automatically deleted.
				This applies regardless of retention settings and matches OpenAI&rsquo;s
				own Responses API retention. Send <code>store: false</code> with the
				request to opt out; other endpoints, such as{" "}
				<code>/v1/chat/completions</code> and <code>/v1/messages</code>, are
				unaffected. Payloads may also be held transiently in memory or cache
				while a request is being processed.
			</p>
			<h3>c. Cookies and Local Storage</h3>
			<p>
				We use first-party cookies and local storage to keep you signed in,
				remember your UI preferences, and operate basic product analytics
				(PostHog). Browser-level Do Not Track signals are not currently a
				supported opt-out mechanism. To opt out of analytics, contact us at{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>; we are
				working on a self-serve in-app toggle.
			</p>
			<hr />
			<h2>2. How We Use Information</h2>
			<ul>
				<li>To operate, secure, and improve the DevPass service</li>
				<li>To meter usage, enforce plan allowances, and process billing</li>
				<li>
					To power dashboards (per-agent costs, sessions, and usage trends)
				</li>
				<li>To detect abuse, fraud, and policy violations</li>
				<li>
					To send transactional emails (receipts, plan changes) and, with
					consent, occasional product updates
				</li>
			</ul>
			<p>
				As stated in the Base Policy, we do <strong>not</strong> sell your
				personal data, and we do <strong>not</strong> use your prompts or
				completions to train any model of ours.
			</p>
			<hr />
			<h2>3. Sharing With AI Providers</h2>
			<p>
				When you make a request, your prompt is forwarded to the AI provider you
				selected. Each provider applies its own privacy and data-retention
				policy to that traffic. You can enable <strong>No AI training</strong>{" "}
				in DevPass Settings to restrict routing to providers that explicitly
				state API inputs are not used to train models. Providers with an unknown
				training policy are excluded while this setting is enabled, so some
				models may be unavailable. The Base Policy&rsquo;s sections on AI
				Providers and on stealth/undisclosed providers also apply to DevPass.
			</p>
			<hr />
			<h2>4. Sub-processors</h2>
			<p>
				DevPass uses the same sub-processors as the rest of the LLM Gateway
				platform. The complete, versioned list — including what each one
				processes, its primary processing locations, and how changes are
				notified — is maintained on the{" "}
				<a href="https://llmgateway.io/legal/sub-processors">
					LLM Gateway Sub-processor page
				</a>
				. That page is the authoritative disclosure and is updated independently
				of this supplemental policy.
			</p>
			<hr />
			<h2>5. Data Retention</h2>
			<p>
				This section supplements the Base Policy&rsquo;s Data Retention terms:
			</p>
			<ul>
				<li>
					<strong>Account and billing data</strong> — kept for the life of your
					account, and deleted promptly when you delete it. Billing and
					accounting records — purchases, payments, and the transaction history
					of credits bought and spent — are retained to meet legal, tax, and
					accounting obligations for 10 years, even after you delete your
					account, after which they are deleted or anonymized
				</li>
				<li>
					<strong>Request metadata</strong> — kept for the life of your active
					DevPass subscription on every plan (Lite, Pro, and Max)
				</li>
				<li>
					<strong>Request payloads</strong> — not retained; prompts and
					responses are discarded once the request completes. The one exception
					is the Responses API described in Section&nbsp;1b, whose stored
					responses are kept for up to 30 days and then deleted
				</li>
				<li>
					<strong>Logs and audit trails</strong> — kept for security and
					integrity for up to 12 months
				</li>
			</ul>
			<hr />
			<h2>6. Your Rights and Contact</h2>
			<p>
				Your privacy rights (including access, correction, deletion, export,
				objection, and the right to lodge a complaint with a supervisory
				authority), our security practices, and international transfer
				safeguards are described in the{" "}
				<a href="https://llmgateway.io/privacy">LLM Gateway Privacy Policy</a>{" "}
				and apply to DevPass. To exercise any of these rights, or for questions
				about this Policy, email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a> from
				the address associated with your account.
			</p>
			<p>© 2026 LLM Gateway. All rights reserved.</p>
		</>
	);
}
