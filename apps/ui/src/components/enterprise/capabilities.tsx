import {
	ArrowUpRight,
	Bell,
	FileSearch,
	GitBranch,
	Lock,
	Paintbrush,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { enterpriseFeatures } from "@/lib/enterprise-features";

const iconMap = {
	"shield-check": ShieldCheck,
	"git-branch": GitBranch,
	audit: FileSearch,
	bell: Bell,
	lock: Lock,
	paintbrush: Paintbrush,
} as const;

const accentMap: Record<string, string> = {
	indigo: "from-indigo-500/20 to-indigo-500/0 text-indigo-400",
	amber: "from-amber-500/20 to-amber-500/0 text-amber-400",
	emerald: "from-emerald-500/20 to-emerald-500/0 text-emerald-400",
	rose: "from-rose-500/20 to-rose-500/0 text-rose-400",
	sky: "from-sky-500/20 to-sky-500/0 text-sky-400",
	violet: "from-violet-500/20 to-violet-500/0 text-violet-400",
};

const accentBorderMap: Record<string, string> = {
	indigo: "hover:border-indigo-500/40",
	amber: "hover:border-amber-500/40",
	emerald: "hover:border-emerald-500/40",
	rose: "hover:border-rose-500/40",
	sky: "hover:border-sky-500/40",
	violet: "hover:border-violet-500/40",
};

export function EnterpriseCapabilities() {
	return (
		<section
			id="capabilities"
			className="relative py-24 sm:py-32 overflow-hidden"
		>
			<div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-border to-transparent" />
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_-10%,rgba(99,102,241,0.08),transparent_55%),radial-gradient(circle_at_80%_110%,rgba(16,185,129,0.06),transparent_55%)]" />

			<div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex flex-col items-start gap-4 mb-16 max-w-3xl">
					<span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1 backdrop-blur-sm">
						<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
						<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
							Newly shipped
						</span>
					</span>
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						Six capabilities your security team will actually approve
					</h2>
					<p className="text-lg text-muted-foreground leading-relaxed text-balance">
						The pieces that turn LLM Gateway from a developer tool into an
						auditable, multi-team, multi-tenant production platform. Each one
						ships with audit trails, SSO-aware permissions, and SIEM-ready
						exports.
					</p>
				</div>

				<div className="grid gap-px bg-border rounded-2xl overflow-hidden border border-border lg:grid-cols-3 md:grid-cols-2">
					{enterpriseFeatures.map((feature) => {
						const Icon = iconMap[feature.iconName];
						return (
							<Link
								key={feature.slug}
								href={`/enterprise/${feature.slug}`}
								className={`group relative flex flex-col gap-6 bg-background p-8 transition-colors hover:bg-card border border-transparent ${accentBorderMap[feature.accent]}`}
							>
								<div
									className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${accentMap[feature.accent]}`}
								/>
								<div className="relative flex items-start justify-between">
									<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/60 ring-1 ring-border">
										<Icon className="h-5 w-5" />
									</div>
									<ArrowUpRight className="h-5 w-5 text-muted-foreground transition-all duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-foreground" />
								</div>

								<div className="relative flex flex-col gap-2">
									<h3 className="text-xl font-semibold tracking-tight">
										{feature.title}
									</h3>
									<p className="text-sm font-medium text-muted-foreground">
										{feature.tagline}
									</p>
								</div>

								<p className="relative text-sm text-muted-foreground leading-relaxed mt-auto">
									{feature.description}
								</p>

								<span className="relative inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
									Read the deep-dive
									<ArrowUpRight className="h-3 w-3" />
								</span>
							</Link>
						);
					})}
				</div>

				<div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-5 py-4">
					<p className="text-sm text-muted-foreground">
						Every capability ships under our enterprise plan — talk to us about
						scoping for your environment.
					</p>
					<Link
						href="/enterprise#contact"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
					>
						Book a 20-min walkthrough
						<ArrowUpRight className="h-3.5 w-3.5" />
					</Link>
				</div>
			</div>
		</section>
	);
}
