import {
	ArrowUpRight,
	FileCheck,
	Globe,
	KeyRound,
	Lock,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { MARKETING_STATS } from "@llmgateway/shared";

const assurances = [
	{
		icon: Lock,
		title: "Encrypted everywhere",
		description: "TLS in transit, AES-256 at rest — including provider keys.",
	},
	{
		icon: KeyRound,
		title: "SSO upon request",
		description: "Okta, Azure AD, and Google with role-based permissions.",
	},
	{
		icon: FileCheck,
		title: "Tamper-evident audit logs",
		description:
			"Every change — configuration, permissions, spend limits, key rotations.",
	},
	{
		icon: ShieldCheck,
		title: `${MARKETING_STATS.uptimeSla} uptime SLA`,
		description: "Backed by live status at status.llmgateway.io.",
	},
];

export function SecurityEnterprise() {
	return (
		<section className="relative py-24 sm:py-32 overflow-hidden">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(59,130,246,0.07),transparent_50%),radial-gradient(circle_at_85%_100%,rgba(99,102,241,0.06),transparent_50%)]" />

			<div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
				<div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start mb-16">
					<div className="flex flex-col items-start gap-4">
						<span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1 backdrop-blur-sm">
							<ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
							<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
								Security &amp; Compliance
							</span>
						</span>
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
							Your security review, already answered
						</h2>
					</div>
					<p className="text-lg text-muted-foreground leading-relaxed lg:pt-14">
						Prompts, completions, and API keys flow through your gateway — so
						the layer in the middle has to hold itself to a higher standard than
						the integrations it replaces. Ours is independently audited, and the
						evidence is one click away.
					</p>
				</div>

				<div className="grid md:grid-cols-2 gap-6">
					{/* SOC 2 Type II */}
					<div className="group relative flex flex-col gap-6 rounded-2xl border border-border bg-card/50 p-8 transition-colors hover:border-blue-500/40">
						<div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
						<div className="relative flex items-start justify-between">
							{/* Per AICPA guidelines the SOC logo must link to aicpa.org/soc4so */}
							<a
								href="https://www.aicpa.org/soc4so"
								target="_blank"
								rel="noopener noreferrer"
								className="shrink-0"
							>
								<img
									src="/badges/aicpa-soc.png"
									alt="AICPA SOC for Service Organizations badge"
									width={64}
									height={64}
									loading="lazy"
									className="h-16 w-16"
								/>
							</a>
							<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-emerald-400">
								Audited
							</span>
						</div>
						<div className="relative flex flex-col gap-2">
							<h3 className="text-2xl font-semibold tracking-tight">
								SOC 2 Type II
							</h3>
							<p className="text-muted-foreground leading-relaxed">
								Independently audited against the AICPA Trust Services Criteria
								for security, availability, and confidentiality — controls
								verified in operation over a sustained period, not just on
								paper.
							</p>
						</div>
						<a
							href="https://security.llmgateway.io/"
							target="_blank"
							rel="noopener noreferrer"
							className="relative mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-blue-500"
						>
							Request the full report
							<ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
						</a>
					</div>

					{/* GDPR */}
					<div className="group relative flex flex-col gap-6 rounded-2xl border border-border bg-card/50 p-8 transition-colors hover:border-blue-500/40">
						<div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
						<div className="relative flex items-start justify-between">
							<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-blue-400/50 bg-blue-500/10">
								<Globe className="h-7 w-7 text-blue-400" />
							</div>
							<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-emerald-400">
								Compliant
							</span>
						</div>
						<div className="relative flex flex-col gap-2">
							<h3 className="text-2xl font-semibold tracking-tight">GDPR</h3>
							<p className="text-muted-foreground leading-relaxed">
								Data processing aligned with GDPR, with a DPA and subprocessor
								list ready for your legal team. Per-project routing can pin
								regulated workloads to EU regions to keep your compliance scope
								tight.
							</p>
						</div>
						<Link
							href="/legal/privacy"
							className="relative mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-blue-500"
						>
							Read our privacy policy
							<ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
						</Link>
					</div>
				</div>

				<div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
					{assurances.map((item) => (
						<div
							key={item.title}
							className="flex flex-col gap-3 bg-background p-6 transition-colors hover:bg-card"
						>
							<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border">
								<item.icon className="h-4 w-4 text-muted-foreground" />
							</div>
							<div>
								<h4 className="font-semibold text-sm">{item.title}</h4>
								<p className="mt-1 text-sm text-muted-foreground leading-relaxed">
									{item.description}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
