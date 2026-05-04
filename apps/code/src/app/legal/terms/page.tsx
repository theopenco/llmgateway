import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Use — DevPass",
	description:
		"Review the Terms of Use for DevPass. Learn about account eligibility, billing, fair-use limits, AI provider policies, and developer responsibilities when using our flat-rate AI coding subscription.",
};

export default function TermsPage() {
	return (
		<>
			<h1>Terms of Use</h1>
			<p>
				<strong>Effective Date:</strong> April 26, 2026
				<br />
				<strong>Last Updated:</strong> April 26, 2026
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
					Mistral, DeepSeek, and others through coding tools like Claude Code,
					Cursor, Cline, OpenCode, Codex, and Autohand
				</li>
				<li>
					Track usage, costs, and per-agent activity in your DevPass dashboard
				</li>
				<li>Manage a single API key shared across every supported tool</li>
			</ul>
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
			<p>DevPass is sold as a tiered monthly or annual subscription:</p>
			<ul>
				<li>
					<strong>Lite, Pro, and Max</strong> tiers each include a monthly
					model-usage allowance, denominated in dollars of provider cost
				</li>
				<li>
					Annual billing is offered at a discount; the discounted total is
					charged up front and renews annually
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
			<h2>5. Data and Privacy</h2>
			<p>
				Your data is handled according to our{" "}
				<Link href="/legal/privacy">Privacy Policy</Link>. Request payloads,
				responses, and per-agent metadata are stored to power your dashboard,
				usage reporting, and per-tool insights, subject to the retention options
				available in your account settings.
			</p>
			<hr />
			<h2>6. Acceptable Use</h2>
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
				<li>Probe, scan, or attack the platform or any connected provider</li>
			</ul>
			<p>
				We reserve the right to suspend or terminate accounts engaged in abuse,
				fraud, or policy violations, including provider-level policy violations.
			</p>
			<hr />
			<h2>7. AI Provider Usage</h2>
			<p>
				When you use AI models through DevPass, you are also subject to the
				terms and acceptable-use policies of the underlying providers (such as
				Anthropic, OpenAI, Google, Mistral, DeepSeek, and others). DevPass
				routes and meters traffic — we do not control provider model behavior
				and we are not liable for provider outages or model output quality.
			</p>
			<hr />
			<h2>8. Intellectual Property</h2>
			<p>
				All rights in DevPass and LLM Gateway (software, design, and branding)
				are owned by us or our licensors. You retain ownership of your prompts
				and generated outputs. You grant us a limited license to process your
				data solely to provide and improve the Service.
			</p>
			<hr />
			<h2>9. Termination</h2>
			<p>
				You can cancel anytime from the dashboard. We may suspend or terminate
				your account if you violate these Terms, misuse the Service, or as
				required by law. On termination, access ceases and stored data is
				deleted according to your retention settings.
			</p>
			<hr />
			<h2>10. Disclaimers</h2>
			<p>
				The Service is provided <strong>&ldquo;as is&rdquo;</strong> and{" "}
				<strong>&ldquo;as available&rdquo;</strong> without warranties of any
				kind. We do not guarantee that the Service will be error-free,
				uninterrupted, or that AI outputs will be accurate, safe, or fit for a
				particular purpose. You are responsible for reviewing AI-generated code
				before relying on it.
			</p>
			<hr />
			<h2>11. Limitation of Liability</h2>
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
			<h2>12. Indemnification</h2>
			<p>
				You agree to indemnify and hold harmless LLM Gateway and DevPass, our
				founders, employees, and partners from any claims, damages, or expenses
				arising from your use or misuse of the Service or violation of these
				Terms or third-party rights.
			</p>
			<hr />
			<h2>13. Changes to These Terms</h2>
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
			<h2>14. Governing Law</h2>
			<p>
				These Terms are governed by the laws of <strong>Delaware, USA</strong>,
				without regard to conflict-of-laws principles. Disputes will be resolved
				in the state or federal courts located in Delaware.
			</p>
			<hr />
			<h2>15. Contact</h2>
			<p>
				Questions about these Terms? Email{" "}
				<a href="mailto:contact@llmgateway.io">contact@llmgateway.io</a>.
			</p>
			<p>© 2026 LLM Gateway. All rights reserved.</p>
		</>
	);
}
