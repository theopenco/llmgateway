import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Notice — Airside",
	description:
		"Supplemental Airside Privacy Notice for AI model providers. What the carrier console collects, how claims and filings are reviewed, what traffic data you see, and how long it is kept.",
	alternates: { canonical: "/legal/privacy" },
	openGraph: {
		title: "Airside Supplemental Privacy Notice",
		description:
			"What Airside collects from carriers, why, and how long it is kept.",
		url: "https://airside.llmgateway.io/legal/privacy",
		type: "article",
	},
};

export default function PrivacyPage() {
	return (
		<>
			<h1>Airside Supplemental Privacy Notice</h1>
			<p>
				<strong>Effective Date:</strong> August 27, 2026
				<br />
				<strong>Last Updated:</strong> August 27, 2026
			</p>
			<p>
				This notice describes how <strong>LLM Gateway</strong>, a service of{" "}
				<strong>Polar Lights LLC</strong>, handles personal data in{" "}
				<strong>Airside</strong>, the carrier console at{" "}
				<a href="https://airside.llmgateway.io">airside.llmgateway.io</a>.
			</p>
			<p>
				<strong>
					It supplements the main{" "}
					<a href="https://llmgateway.io/legal/privacy">
						LLM Gateway Privacy Policy
					</a>
					, which applies in full
				</strong>{" "}
				and covers everything not specific to Airside — legal bases, security,
				international transfers, your rights, and how to exercise them. Where
				this notice and the main policy conflict for Airside, this notice
				controls for that conflict only.
			</p>
			<p>
				Airside is a business-facing console. The personal data involved is
				almost entirely <strong>business contact data</strong> about the people
				who operate a carrier account — not data about the developers whose
				requests we route.
			</p>
			<hr />

			<h2>1. What We Collect</h2>
			<h3>Account and company data</h3>
			<ul>
				<li>
					<strong>Your account:</strong> name, email address, authentication
					credentials (password hash or passkey), and email-verification status.
					Sign-in via GitHub or Google, where enabled, provides your name, email
					address, and account identifier.
				</li>
				<li>
					<strong>Your provider company:</strong> company name, website, the
					members of the company account, and each member&rsquo;s role.
				</li>
			</ul>
			<h3>Claim data</h3>
			<ul>
				<li>
					The provider claimed, the claim type, and the{" "}
					<strong>registrable email domain that satisfied the match</strong> —
					this is the record of how the claim was authorized, so we retain it
					for as long as the claim exists.
				</li>
				<li>
					For a newly registered provider: the submitted display name,
					OpenAI-compatible API base URL, and description.
				</li>
				<li>
					Logo and icon files you upload, which are stored with the claim and
					displayed publicly.
				</li>
				<li>
					Review metadata: which account filed the claim, who reviewed it, the
					decision, any review note, and the timestamps.
				</li>
			</ul>
			<h3>Listing and filing data</h3>
			<ul>
				<li>
					Model listings and their attributes, and every tariff filing with its
					prices, your note, the reviewer&rsquo;s decision and note, and who
					submitted it.
				</li>
				<li>Your routing discount and the gateway margin you accept.</li>
			</ul>
			<p>
				Filings are an audit trail: because a filed price is what developers are
				billed, we keep the full history of filings and decisions, including
				rejected ones, together with the accounts that submitted and reviewed
				them.
			</p>
			<h3>Payment data</h3>
			<p>
				Where a listing fee applies, checkout is handled by{" "}
				<strong>Stripe</strong>. We store the Stripe checkout session
				identifier, whether the fee is paid, and when — we never receive or
				store your full card number.
			</p>
			<h3>Technical data</h3>
			<p>
				Standard server and security logs (IP address, user agent, timestamps)
				generated when you use the console, as described in the main policy.
			</p>
			<hr />

			<h2>2. Traffic Data You See Is Aggregated</h2>
			<p>
				The console reports usage of your claimed providers: requests, errors,
				tokens, and billed traffic, broken down by model and by day.
			</p>
			<p>
				<strong>
					These figures come from pre-aggregated hourly rollups, not from
					individual request records.
				</strong>{" "}
				They are summed across every gateway tenant that routed to you, and they
				deliberately exclude the identity of the organizations, projects, API
				keys, and end users behind that traffic. Prompts and responses are never
				exposed to carriers through Airside. Under the Airside Terms you must
				not attempt to re-identify the sources of this traffic.
			</p>
			<p>
				This is separate from what you receive as a provider: when we route a
				request to your endpoint, you receive its content directly and act as an
				independent controller of any personal data in it, under your own
				privacy policy.
			</p>
			<hr />

			<h2>3. How We Use It</h2>
			<ul>
				<li>
					<strong>To verify and review claims</strong> — matching your verified
					email domain against the provider&rsquo;s endpoint or website, and
					deciding whether to approve.
				</li>
				<li>
					<strong>To operate your listings</strong> — publishing approved models
					and prices into the catalogue and routing requests to them.
				</li>
				<li>
					<strong>To bill correctly</strong> — filed prices determine what
					developers are charged, and the margin you accept determines what is
					attributed to you.
				</li>
				<li>
					<strong>To collect the listing fee</strong> where one applies.
				</li>
				<li>
					<strong>To communicate with you</strong> about reviews, decisions,
					listing issues, and service changes.
				</li>
				<li>
					<strong>To protect the platform</strong> — detecting fraudulent
					claims, abuse, and misrepresented listings.
				</li>
			</ul>
			<p>
				We do not sell your data, and we do not use it for advertising or
				profiling.
			</p>
			<hr />

			<h2>4. What Is Public</h2>
			<p>
				Once a claim is approved, the following appear on public LLM Gateway
				pages: your provider name and description, the logo and icon you upload,
				and your listed models with their approved prices and capabilities. Your
				account email address, the matched domain, filing notes, and review
				notes are <strong>not</strong> public.
			</p>
			<hr />

			<h2>5. Sharing and Sub-processors</h2>
			<p>
				We share Airside data only with the sub-processors listed in the main{" "}
				<a href="https://llmgateway.io/legal/sub-processors">
					sub-processor list
				</a>
				, which for Airside principally means our hosting and database
				providers, <strong>Stripe</strong> for the listing fee, and our
				transactional email provider. We also share where required by law or to
				enforce our terms, as described in the main policy.
			</p>
			<hr />

			<h2>6. Retention</h2>
			<ul>
				<li>
					<strong>Account and company records</strong> — for as long as the
					account exists, then deleted or anonymized in line with the main
					policy.
				</li>
				<li>
					<strong>Claims, listings, and filings</strong> — retained while the
					carrier is active and afterwards for as long as needed as a billing
					and pricing audit trail, because they evidence what developers were
					charged.
				</li>
				<li>
					<strong>Payment records</strong> — as required by tax and accounting
					law.
				</li>
				<li>
					<strong>Aggregated usage rollups</strong> — retained as platform-level
					statistics; they contain no carrier or developer identities beyond the
					provider and model.
				</li>
			</ul>
			<p>
				Deleting your account removes you from the provider company. Where you
				are the only member, the company&rsquo;s claims and listings are
				withdrawn from routing; records we are required to keep for audit,
				billing, or legal reasons are retained as described above.
			</p>
			<hr />

			<h2>7. Your Rights and Contact</h2>
			<p>
				You have the rights described in Section&nbsp;9 of the main{" "}
				<a href="https://llmgateway.io/legal/privacy">
					LLM Gateway Privacy Policy
				</a>{" "}
				— including access, correction, deletion, portability, and objection —
				and the same routes to exercise them. Note that we may need to retain
				pricing and filing records that are necessary to evidence past billing
				even after an erasure request, as permitted by law.
			</p>
			<p>
				Privacy questions about Airside:{" "}
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
