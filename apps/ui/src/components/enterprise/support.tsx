import { ArrowRight, Hash, Headphones, Rocket, Zap } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

const perks = [
	{
		icon: Hash,
		title: "A dedicated Slack or Discord channel",
		description:
			"Your engineers and ours in one room, in the tool your team already uses. No ticket portal, no triage bot.",
	},
	{
		icon: Headphones,
		title: "Answers from the people who built it",
		description:
			"24/7 priority support staffed by gateway engineers — the same people who wrote the routing layer your traffic runs on.",
	},
	{
		icon: Rocket,
		title: "Hands-on onboarding and migration",
		description:
			"We help move your traffic, keys, and routing rules over — and stay in the channel until your team is fully ramped.",
	},
	{
		icon: Zap,
		title: "Early access to new features",
		description:
			"Enterprise customers get new capabilities first, with a direct line to shape what we build next.",
	},
];

const messages = [
	{
		initials: "SK",
		name: "Sarah",
		org: "Acme",
		time: "2:47 AM",
		avatarClass: "bg-rose-500/20 text-rose-400",
		text: "Seeing elevated p95 latency on our EU traffic for claude-sonnet requests — anything on your end?",
	},
	{
		initials: "LG",
		name: "Max",
		org: "LLM Gateway",
		time: "2:51 AM",
		avatarClass: "bg-blue-500/20 text-blue-400",
		badge: "4 min response",
		text: "On it. One upstream provider is degraded in eu-west — we've shifted your routing to the healthy fallback. p95 should normalize within a minute.",
	},
	{
		initials: "SK",
		name: "Sarah",
		org: "Acme",
		time: "2:53 AM",
		avatarClass: "bg-rose-500/20 text-rose-400",
		text: "Confirmed, dashboards look clean again. 🙌",
	},
];

export function SupportEnterprise() {
	return (
		<section className="border-t border-border bg-muted/30 py-24 sm:py-32">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
					{/* Left column - copy */}
					<div className="flex flex-col items-start gap-4">
						<span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1 backdrop-blur-sm">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
							<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
								Enterprise Support
							</span>
						</span>
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
							A direct line, not a ticket queue
						</h2>
						<p className="text-lg text-muted-foreground leading-relaxed">
							When LLM traffic is on your critical path, "we'll get back to you
							in 2–3 business days" isn't support. Every enterprise plan
							includes a shared channel with our engineering team.
						</p>

						<div className="mt-6 grid gap-6 sm:grid-cols-2">
							{perks.map((perk) => (
								<div key={perk.title} className="flex flex-col gap-2">
									<div className="flex items-center gap-3">
										<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border">
											<perk.icon className="h-4 w-4 text-blue-500" />
										</div>
										<h3 className="font-semibold text-sm">{perk.title}</h3>
									</div>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{perk.description}
									</p>
								</div>
							))}
						</div>

						<Button size="lg" className="mt-6" asChild>
							<Link href="/enterprise#contact">
								Get your dedicated channel
								<ArrowRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
					</div>

					{/* Right column - chat mockup */}
					<div className="relative">
						<div className="pointer-events-none absolute -inset-8 bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.08),transparent_70%)]" />
						<div className="relative overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
							<div className="flex items-center justify-between border-b border-border px-5 py-3.5">
								<div className="flex items-center gap-2">
									<Hash className="h-4 w-4 text-muted-foreground" />
									<span className="font-semibold text-sm">
										acme-x-llmgateway
									</span>
								</div>
								<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
									<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
									Engineers online
								</span>
							</div>

							<div className="flex flex-col gap-5 p-5">
								{messages.map((message, index) => (
									<div key={index} className="flex items-start gap-3">
										<div
											className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${message.avatarClass}`}
										>
											{message.initials}
										</div>
										<div className="min-w-0">
											<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
												<span className="font-semibold text-sm">
													{message.name}
												</span>
												<span className="text-xs text-muted-foreground">
													{message.org} · {message.time}
												</span>
												{message.badge ? (
													<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400">
														{message.badge}
													</span>
												) : null}
											</div>
											<p className="mt-1 text-sm text-muted-foreground leading-relaxed">
												{message.text}
											</p>
										</div>
									</div>
								))}
							</div>

							<div className="border-t border-border px-5 py-3">
								<p className="text-xs text-muted-foreground">
									Slack or Discord — wherever your team already lives.
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
