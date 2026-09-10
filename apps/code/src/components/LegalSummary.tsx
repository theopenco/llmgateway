import {
	BadgeCheck,
	Ban,
	Clock,
	DatabaseZap,
	Info,
	Share2,
	ShieldCheck,
	Terminal,
	UserRound,
	Wallet,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface SummaryCard {
	icon: LucideIcon;
	title: string;
	body: ReactNode;
}

const termsCards: SummaryCard[] = [
	{
		icon: Info,
		title: "An addendum to the main terms",
		body: (
			<>
				These DevPass terms add to the LLM Gateway Terms of Use, which still
				govern everything not covered here — eligibility, accounts, liability
				and dispute resolution.
			</>
		),
	},
	{
		icon: Wallet,
		title: "Flat monthly subscription",
		body: (
			<>
				Lite, Pro and Max each include a monthly usage allowance measured in
				provider cost. Allowances reset every cycle and don&rsquo;t roll over,
				except when you upgrade mid-cycle. Fees are generally non-refundable
				once usage begins; a first-payment refund within 14 days may be offered
				as goodwill only while usage remains below 20%.
			</>
		),
	},
	{
		icon: Terminal,
		title: "For approved coding tools only",
		body: (
			<>
				Your key works from whitelisted tools like Claude Code, Codex, Cursor
				and Cline — not from your own apps, backends or scripts. Embeddings,
				image and video generation aren&rsquo;t included.
			</>
		),
	},
	{
		icon: UserRound,
		title: "One account per developer",
		body: (
			<>
				DevPass is for private, individual use — no teams, multi-seat or company
				accounts. Extra accounts or reused payment cards get cancelled without
				notice.
			</>
		),
	},
	{
		icon: DatabaseZap,
		title: "Metadata only, no payloads",
		body: (
			<>
				We store per-agent metadata — tokens, cost, model and routing — to power
				your dashboard. Requests and responses aren&rsquo;t retained, except
				stateful Responses API requests, kept up to 30 days.
			</>
		),
	},
	{
		icon: Ban,
		title: "Fair use",
		body: (
			<>
				Abuse, fraud, key sharing or bad-faith payment disputes can get every
				related account banned immediately, with no refund for the cycle in
				progress.
			</>
		),
	},
];

const privacyCards: SummaryCard[] = [
	{
		icon: Info,
		title: "An addendum to the main policy",
		body: (
			<>
				This policy adds DevPass-specific detail to the LLM Gateway Privacy
				Policy, which still governs everything else — legal bases, your GDPR and
				CCPA rights, security and international transfers.
			</>
		),
	},
	{
		icon: DatabaseZap,
		title: "Metadata only, no prompt storage",
		body: (
			<>
				We log tokens, cost, latency, model, provider and which coding tool sent
				the request. Your prompts and the model&rsquo;s responses aren&rsquo;t
				retained, and there is no setting to turn payload storage on.
			</>
		),
	},
	{
		icon: Clock,
		title: "One exception: the Responses API",
		body: (
			<>
				Requests to <code>/v1/responses</code> are stateful, so their input and
				output items are stored for up to 30 days to make response chaining
				work. Send <code>store: false</code> to opt out.
			</>
		),
	},
	{
		icon: Share2,
		title: "Your request goes to the provider you pick",
		body: (
			<>
				Prompts are forwarded to the AI provider behind the model you chose —
				each applies its own retention and training policy. Enable No AI
				training in Settings to use only providers that explicitly opt API
				inputs out of model training.
			</>
		),
	},
	{
		icon: ShieldCheck,
		title: "Never sold, never used for training",
		body: (
			<>
				We don&rsquo;t sell your personal data and we never train our own models
				on your prompts or completions. Data is shared only with a small set of
				vetted sub-processors.
			</>
		),
	},
	{
		icon: BadgeCheck,
		title: "Retention and your rights",
		body: (
			<>
				Request metadata is kept for the life of your subscription and billing
				records for 10 years where tax law requires it. You can access, export
				or delete your data at any time.
			</>
		),
	},
];

const summaries = {
	terms: {
		heading: "DevPass terms in plain English",
		cards: termsCards,
	},
	privacy: {
		heading: "DevPass privacy in plain English",
		cards: privacyCards,
	},
} satisfies Record<string, { heading: string; cards: SummaryCard[] }>;

export function LegalSummary({
	variant = "terms",
}: {
	variant?: keyof typeof summaries;
}) {
	const summary = summaries[variant];

	return (
		<section className="my-10">
			<div className="mb-6">
				<h2 className="text-xl font-semibold tracking-tight text-foreground mb-2">
					{summary.heading}
				</h2>
				<p className="text-sm text-muted-foreground">
					A human-readable summary of the key points. This overview is for
					convenience only and is{" "}
					<span className="text-foreground font-medium">
						not legally binding
					</span>{" "}
					— the full text below is what governs.
				</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{summary.cards.map((card) => {
					const Icon = card.icon;
					return (
						<div
							key={card.title}
							className="flex gap-3 rounded-xl border bg-card p-5"
						>
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<Icon className="h-5 w-5" />
							</div>
							<div className="space-y-1">
								<div className="font-semibold leading-snug text-foreground">
									{card.title}
								</div>
								<p className="text-sm leading-6 text-muted-foreground">
									{card.body}
								</p>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
