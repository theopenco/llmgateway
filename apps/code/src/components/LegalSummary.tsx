import {
	Ban,
	DatabaseZap,
	Info,
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
				except when you upgrade mid-cycle.
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

export function LegalSummary() {
	return (
		<section className="my-10">
			<div className="mb-6">
				<h2 className="text-xl font-semibold tracking-tight text-foreground mb-2">
					DevPass terms in plain English
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
				{termsCards.map((card) => {
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
