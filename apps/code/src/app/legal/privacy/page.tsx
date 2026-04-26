import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Policy — DevPass",
	description:
		"How DevPass collects, uses, and protects your data — including request retention, AI provider routing, cookies, and your privacy rights.",
};

export default function PrivacyPage() {
	return (
		<>
			<h1>Privacy Policy</h1>
			<p>
				<strong>Effective Date:</strong> April 26, 2026
				<br />
				<strong>Last Updated:</strong> April 26, 2026
			</p>
			<p>
				This Privacy Policy describes how <strong>LLM Gateway</strong>{" "}
				(&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) collects,
				uses, and protects information when you use <strong>DevPass</strong>,
				our flat-rate subscription for AI coding tools, available at{" "}
				<a href="https://code.llmgateway.io">code.llmgateway.io</a>.
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
				Whether full request and response <strong>payloads</strong> (your
				prompts and the model output) are stored depends on your DevPass
				retention settings:
			</p>
			<ul>
				<li>
					<strong>Retain all data</strong> — payloads and metadata are stored
					and visible in the dashboard
				</li>
				<li>
					<strong>Metadata only</strong> — only counts, costs, and routing info
					are kept; prompts and responses are discarded after the request
					completes
				</li>
			</ul>
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
				We do <strong>not</strong> sell your personal data, and we do{" "}
				<strong>not</strong> use your prompts or completions to train any model
				of ours.
			</p>
			<hr />
			<h2>3. Sharing With AI Providers</h2>
			<p>
				When you make a request, your prompt is forwarded to the AI provider you
				selected (e.g., Anthropic, OpenAI, Google, Mistral, DeepSeek). Each
				provider applies its own privacy and data-retention policy to that
				traffic. We pass through provider-side opt-outs where supported (for
				example, &ldquo;no training&rdquo; flags). You are responsible for
				reviewing the privacy policies of any provider you use.
			</p>
			<hr />
			<h2>4. Sub-processors</h2>
			<p>We rely on a small set of vetted sub-processors:</p>
			<ul>
				<li>
					<strong>Stripe</strong> — billing and subscription management
				</li>
				<li>
					<strong>PostgreSQL / Redis hosting</strong> — application data and
					caching
				</li>
				<li>
					<strong>PostHog</strong> — product analytics
				</li>
				<li>
					<strong>Email delivery providers</strong> — transactional email
				</li>
				<li>AI providers, as listed in the DevPass model catalog</li>
			</ul>
			<p>
				Each sub-processor is bound by contractual data-protection obligations.
			</p>
			<hr />
			<h2>5. Data Retention</h2>
			<ul>
				<li>
					<strong>Account and billing data</strong> — kept for the life of your
					account, plus a reasonable period afterward to meet legal, tax, and
					accounting obligations
				</li>
				<li>
					<strong>Request metadata</strong> — kept for the life of your active
					DevPass subscription according to your retention setting (default:
					retained on Lite, Pro, and Max)
				</li>
				<li>
					<strong>Request payloads</strong> — only stored if you opt in; you can
					purge them at any time from settings
				</li>
				<li>
					<strong>Logs and audit trails</strong> — kept for security and
					integrity for up to 12 months
				</li>
			</ul>
			<hr />
			<h2>6. Security</h2>
			<p>
				We use TLS in transit, encrypted database storage at rest, scoped API
				keys, and isolated per-organization data access controls. No system is
				perfectly secure — please report suspected vulnerabilities to{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>.
			</p>
			<hr />
			<h2>7. Your Rights</h2>
			<p>
				Depending on your jurisdiction (GDPR, UK GDPR, CCPA, and others), you
				may have the right to:
			</p>
			<ul>
				<li>Access, correct, or delete your personal data</li>
				<li>Export a copy of your data</li>
				<li>Object to or restrict certain processing</li>
				<li>Withdraw consent for marketing communications</li>
			</ul>
			<p>
				To exercise these rights, email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a> from
				the address associated with your account.
			</p>
			<hr />
			<h2>8. International Transfers</h2>
			<p>
				DevPass is operated from the United States; AI providers we route to may
				be located in the US, EU, or other regions. Where required, we rely on
				Standard Contractual Clauses or equivalent mechanisms for cross-border
				transfers.
			</p>
			<hr />
			<h2>9. Children&rsquo;s Privacy</h2>
			<p>
				DevPass is not intended for children under 16 (or the local age of
				digital consent). We do not knowingly collect data from children.
			</p>
			<hr />
			<h2>10. Changes to This Policy</h2>
			<p>
				We may update this Policy from time to time. The latest version is
				always available at{" "}
				<a href="https://code.llmgateway.io/legal/privacy">
					code.llmgateway.io/legal/privacy
				</a>
				. Material changes will be communicated by email or in-app notice.
			</p>
			<hr />
			<h2>11. Contact</h2>
			<p>
				Questions about this Policy? Email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>.
			</p>
			<p>© 2026 LLM Gateway. All rights reserved.</p>
		</>
	);
}
