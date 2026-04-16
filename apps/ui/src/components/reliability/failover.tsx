"use client";

import { AlertCircle, ArrowRight, CheckCircle2, Zap } from "lucide-react";

export function ReliabilityFailover() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-5xl">
					<div className="mb-12 text-center sm:mb-16">
						<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5">
							<span className="text-xs font-mono text-blue-500">
								HOW IT WORKS
							</span>
						</div>
						<h2 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
							Automatic failover in milliseconds.
						</h2>
						<p className="mx-auto max-w-3xl text-lg leading-relaxed text-muted-foreground text-balance">
							Every request is health-checked in real time. The moment a
							provider starts failing, returning 5xx, or timing out, traffic is
							diverted to the next healthy one — on the same request.
						</p>
					</div>

					<div className="grid gap-6 md:grid-cols-3">
						<div className="rounded-xl border border-border bg-card p-6">
							<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
								<AlertCircle className="h-5 w-5" />
							</div>
							<h3 className="mb-2 text-lg font-semibold">Provider fails</h3>
							<p className="text-sm text-muted-foreground">
								An upstream provider returns a 5xx, times out, or rate limits
								your request. We detect it within the same request cycle.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
								<Zap className="h-5 w-5" />
							</div>
							<h3 className="mb-2 text-lg font-semibold">Instant re-route</h3>
							<p className="text-sm text-muted-foreground">
								The Gateway automatically retries the same prompt against the
								next healthy provider for that model, so your app does not
								experience additional latency.
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card p-6">
							<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
								<CheckCircle2 className="h-5 w-5" />
							</div>
							<h3 className="mb-2 text-lg font-semibold">Response delivered</h3>
							<p className="text-sm text-muted-foreground">
								Your user gets their answer. Our status dashboard records the
								incident for you — your service stays up even when providers
								don&apos;t.
							</p>
						</div>
					</div>

					<div className="mt-10 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-6 sm:flex-row">
						<span className="text-sm font-medium text-muted-foreground">
							Works with every request
						</span>
						<ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
						<code className="rounded-md bg-background px-3 py-1 font-mono text-xs">
							POST /v1/chat/completions
						</code>
						<ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
						<span className="text-sm font-medium text-foreground">
							No SDK changes. No config.
						</span>
					</div>
				</div>
			</div>
		</section>
	);
}
