import { ArrowRight, Sparkles, Terminal, Zap } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

import { IntegrationGuidesGrid } from "@llmgateway/shared/components";

function DevPlansCta() {
	return (
		<a
			href="https://devpass.llmgateway.io"
			target="_blank"
			rel="noopener noreferrer"
			className="group relative mb-10 block overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background to-muted/40 transition-all duration-500 hover:border-foreground/20 hover:shadow-[0_0_40px_-12px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_0_40px_-12px_rgba(255,255,255,0.06)]"
		>
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-foreground/[0.03] via-transparent to-transparent" />
			<div className="relative flex flex-col gap-8 p-8 sm:p-10 md:flex-row md:items-center md:justify-between md:gap-12">
				<div className="flex-1 space-y-4">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
							<Terminal className="h-5 w-5" strokeWidth={1.5} />
						</div>
						<h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
							DevPass
						</h3>
						<Badge className="border-transparent bg-foreground/10 text-foreground text-[11px] font-medium tracking-wide uppercase">
							New
						</Badge>
					</div>
					<p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">
						Fixed-price monthly plans for Claude Code, Cursor, Cline, and every
						coding tool. One API key, 200+ models, predictable billing.
					</p>
					<div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-sm text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<Zap className="h-3.5 w-3.5" />
							From $29/mo
						</span>
						<span className="hidden sm:inline text-border">|</span>
						<span className="flex items-center gap-1.5">
							<Sparkles className="h-3.5 w-3.5" />
							Every model included
						</span>
					</div>
				</div>
				<div className="shrink-0">
					<Button
						size="lg"
						className="pointer-events-none gap-2 rounded-lg px-6 text-sm font-medium"
						tabIndex={-1}
					>
						Get started
						<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
					</Button>
				</div>
			</div>
		</a>
	);
}

export function IntegrationCards() {
	return (
		<IntegrationGuidesGrid
			header={<DevPlansCta />}
			renderInternalLink={({ href, className, children }) => (
				<Link href={href as never} className={className}>
					{children}
				</Link>
			)}
		/>
	);
}
