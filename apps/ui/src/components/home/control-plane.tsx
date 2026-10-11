import { ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

import styles from "./home.module.css";
import { TrackedLink } from "./tracked-link";

import type { ReactNode } from "react";

type Plan = "Enterprise" | "All plans";

function Panel({
	index,
	plan,
	title,
	body,
	className,
	children,
}: {
	index: string;
	plan: Plan;
	title: string;
	body: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<article
			className={cn(
				"group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors hover:border-blue-500/40 md:p-7",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
				<span>{index}</span>
				<span className="mx-1 h-px flex-1 bg-border" />
				<span
					className={cn(
						"rounded-full px-2 py-0.5 text-[10px] tracking-[0.12em]",
						plan === "Enterprise"
							? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
							: "bg-muted text-muted-foreground",
					)}
				>
					{plan}
				</span>
			</div>
			<h3 className="mt-5 font-display text-xl font-bold tracking-tight">
				{title}
			</h3>
			<p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
				{body}
			</p>
			<div className="mt-6 flex-1">{children}</div>
		</article>
	);
}

const ROLES = [
	{
		who: "maya@acme.com",
		role: "Owner",
		tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
	},
	{
		who: "sam@acme.com",
		role: "Admin",
		tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
	},
	{
		who: "priya@acme.com",
		role: "Project admin",
		tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
	},
	{
		who: "leo@acme.com",
		role: "Developer",
		tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	},
];

const LIMITS = [
	{ name: "support-bot", used: 72 },
	{ name: "coding-agents", used: 94 },
	{ name: "search-summaries", used: 38 },
];

const AUDIT = [
	["4m ago", "maya", "api_key.update_limit"],
	["22m ago", "sam", "team_member.invite"],
	["1h ago", "maya", "organization.update"],
	["3h ago", "sam", "api_key.roll"],
];

const DEPLOYMENTS = [
	{
		name: "Enterprise Cloud",
		body: "We run it for you with a 99.9% SLA and dedicated support.",
	},
	{
		name: "Self-hosted",
		body: "Docker or Kubernetes with our Helm chart, inside your own network. Enterprise features need a license key.",
	},
	{
		name: "Provider policy",
		body: "On Enterprise, route only to providers that meet your rules on headquarters country, data retention and training.",
	},
];

function Redacted({ children }: { children: ReactNode }) {
	return (
		<span className="inline-block whitespace-nowrap rounded bg-foreground px-1 leading-5 text-transparent select-none">
			{children}
		</span>
	);
}

export function ControlPlane() {
	return (
		<section id="controls" className="relative scroll-mt-24 py-24 md:py-32">
			<div className="mx-auto max-w-7xl px-4 sm:px-6">
				<div className="grid gap-8 lg:grid-cols-12 lg:items-end">
					<div className="lg:col-span-7">
						<h2 className="text-balance font-display text-4xl font-bold leading-[1.08] tracking-[-0.03em] md:text-5xl">
							Ship to production.{" "}
							<span className="text-muted-foreground">Keep control.</span>
						</h2>
					</div>
					<p className="text-lg leading-relaxed text-muted-foreground lg:col-span-5">
						Scoped keys, spend caps, failover and guardrails live in the
						gateway, not in your app code. Add SSO and audit logs on Enterprise
						when the rest of the company joins in.
					</p>
				</div>

				<div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
					<Panel
						index="01 / Identity"
						plan="Enterprise"
						title="SSO and roles, not shared keys"
						body="Sign in with Okta, Entra ID or another SAML 2.0 provider, with SCIM provisioning. Roles per organization and project, and API keys scoped per app."
						className="md:col-span-3"
					>
						<ul className="divide-y divide-border rounded-xl border border-border bg-background/60">
							{ROLES.map((r) => (
								<li
									key={r.who}
									className="flex items-center justify-between gap-3 px-4 py-2.5 font-mono text-xs"
								>
									<span className="truncate">{r.who}</span>
									<span
										className={cn(
											"shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
											r.tone,
										)}
									>
										{r.role}
									</span>
								</li>
							))}
						</ul>
					</Panel>

					<Panel
						index="02 / Guardrails"
						plan="Enterprise"
						title="Catch sensitive data before a provider sees it"
						body="Detect emails, card numbers, secrets, prompt injection and jailbreak attempts in chat requests. Block, redact or warn, per organization or project."
						className="md:col-span-3"
					>
						<div className="rounded-xl border border-border bg-background/60 p-4 font-mono text-xs leading-7">
							<span className="text-muted-foreground">prompt › </span>
							Refund the order for <Redacted>jane.doe@acme.com</Redacted> paid
							with card <Redacted>4242 4242 4242 4242</Redacted>
							<div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
								<span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-orange-700 dark:text-orange-300">
									2 entities redacted
								</span>
								<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
									before routing
								</span>
							</div>
						</div>
					</Panel>

					<Panel
						index="03 / Spend"
						plan="All plans"
						title="Spend caps per key and member"
						body="Set a spend cap on any API key or member and requests stop once it is reached, with optional alerts before a key runs out. Team budgets on Enterprise."
						className="md:col-span-2"
					>
						<div className="space-y-3">
							{LIMITS.map((b) => (
								<div key={b.name}>
									<div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground">
										<span>{b.name}</span>
										<span>{b.used}%</span>
									</div>
									<div className="h-2 overflow-hidden rounded-full bg-muted">
										<div
											className={cn(
												"h-full rounded-full",
												b.used > 90 ? "bg-rose-500" : "bg-blue-500",
											)}
											style={{ width: `${b.used}%` }}
										/>
									</div>
								</div>
							))}
						</div>
					</Panel>

					<Panel
						index="04 / Reliability"
						plan="All plans"
						title="Failover in the same request"
						body="When a provider errors, times out or rate-limits you, the gateway retries up to twice on another provider for that model before it responds. Requests pinned to one provider stay there."
						className="md:col-span-2"
					>
						<svg viewBox="0 0 240 90" className="h-24 w-full" aria-hidden>
							<circle cx="18" cy="45" r="7" className="fill-foreground" />
							<path
								d="M25 45 C 90 45, 110 18, 200 18"
								className="stroke-rose-500/70"
								strokeWidth="2"
								fill="none"
								strokeDasharray="3 5"
							/>
							<path
								d="M25 45 C 90 45, 110 72, 200 72"
								className={cn("stroke-emerald-500", styles.dash)}
								strokeWidth="2"
								fill="none"
							/>
							<rect
								x="200"
								y="8"
								width="34"
								height="20"
								rx="5"
								className="fill-rose-500/15 stroke-rose-500/60"
							/>
							<rect
								x="200"
								y="62"
								width="34"
								height="20"
								rx="5"
								className="fill-emerald-500/15 stroke-emerald-500/70"
							/>
							<text
								x="217"
								y="22"
								textAnchor="middle"
								className="fill-rose-600 font-mono text-[9px] dark:fill-rose-400"
							>
								503
							</text>
							<text
								x="217"
								y="76"
								textAnchor="middle"
								className="fill-emerald-600 font-mono text-[9px] dark:fill-emerald-300"
							>
								200
							</text>
						</svg>
					</Panel>

					<Panel
						index="05 / Audit"
						plan="Enterprise"
						title="Audit log"
						body="API key, invite, role, budget and compliance policy changes, with who made them and when."
						className="md:col-span-2"
					>
						<div className="space-y-1.5 font-mono text-[11px]">
							{AUDIT.map(([t, who, action]) => (
								<div key={`${t}-${action}`} className="flex gap-2 truncate">
									<span className="w-12 shrink-0 text-muted-foreground">
										{t}
									</span>
									<span className="shrink-0">{who}</span>
									<span className="truncate text-blue-700 dark:text-blue-300">
										{action}
									</span>
								</div>
							))}
						</div>
					</Panel>

					<article className="relative isolate overflow-hidden rounded-2xl border border-border bg-card p-7 text-card-foreground md:col-span-6 md:p-10">
						<div aria-hidden className={styles.grain} />
						<div
							aria-hidden
							className="absolute -right-32 -top-40 -z-10 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_65%)]"
						/>
						<div className="grid gap-10 md:grid-cols-12 md:items-center">
							<div className="md:col-span-5">
								<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
									06 / Deployment
								</p>
								<h3 className="mt-4 font-display text-3xl font-bold tracking-tight md:text-4xl">
									Run it where your data lives.
								</h3>
								<p className="mt-3 text-muted-foreground">
									Same gateway and dashboard, in our cloud or yours. The core is
									open source under AGPLv3 and the enterprise code is
									source-available, so nothing is a black box.
								</p>
							</div>
							<ul className="grid gap-3 sm:grid-cols-3 md:col-span-7">
								{DEPLOYMENTS.map((d, i) => (
									<li
										key={d.name}
										className="rounded-xl border border-black/10 bg-white/70 p-5 dark:border-white/15 dark:bg-white/[0.03]"
									>
										<span className="font-mono text-[11px] text-muted-foreground">
											0{i + 1}
										</span>
										<p className="mt-2 font-semibold">{d.name}</p>
										<p className="mt-1 text-sm text-muted-foreground">
											{d.body}
										</p>
									</li>
								))}
							</ul>
						</div>
					</article>
				</div>

				<div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
					<TrackedLink
						href="/signup"
						auth
						location="home_control_plane"
						cta="get_api_key"
						className="group inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						Get started
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
					</TrackedLink>
					<TrackedLink
						href="/enterprise"
						location="home_control_plane"
						cta="explore_enterprise"
						className="text-sm font-medium underline-offset-4 hover:underline"
					>
						See everything in Enterprise
					</TrackedLink>
					<TrackedLink
						href="https://security.llmgateway.io/"
						external
						location="home_control_plane"
						cta="trust_center"
						className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
					>
						Trust center
						<ArrowUpRight className="size-3.5" />
					</TrackedLink>
				</div>
			</div>
		</section>
	);
}
