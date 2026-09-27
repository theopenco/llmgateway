import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { editorial } from "./fonts";
import styles from "./home.module.css";
import { TrackedLink } from "./tracked-link";

const STEPS = [
	["Week 1", "Traffic live"],
	["Week 2", "SSO, audit logs and guardrails on"],
	["Day 30", "You decide. No long-term contract before then"],
];

export function Closing() {
	return (
		<section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 md:pb-32">
			<div className="relative isolate overflow-hidden rounded-3xl border border-black/10 bg-[#f4f1e8] px-6 py-14 text-[#111113] sm:px-10 md:px-16 md:py-20 dark:border-white/10 dark:bg-[#0d0d10] dark:text-[#f4f1e8]">
				<div aria-hidden className={styles.grain} />
				<div
					aria-hidden
					className="absolute -bottom-48 left-1/2 -z-10 size-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,184,61,0.24),transparent_65%)]"
				/>
				<div className="mx-auto max-w-3xl text-center">
					<p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
						Enterprise
					</p>
					<h2 className="mt-5 font-display text-4xl font-bold leading-[1.08] tracking-[-0.03em] md:text-6xl">
						Cleared for{" "}
						<span
							className={cn(
								editorial.className,
								"font-normal italic text-amber-600 dark:text-amber-300",
							)}
						>
							takeoff.
						</span>
					</h2>
					<p className="mx-auto mt-5 max-w-xl text-lg text-[#111113]/70 dark:text-[#f4f1e8]/70">
						Security questionnaire, DPA, SAML SSO setup and hands-on migration
						of your keys and routing rules. We handle onboarding with you.
					</p>
					<ol className="mx-auto mt-10 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
						{STEPS.map(([when, what]) => (
							<li
								key={when}
								className="rounded-xl border border-black/10 bg-white/70 px-4 py-3 dark:border-white/15 dark:bg-white/[0.03]"
							>
								<span className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
									{when}
								</span>
								<p className="mt-1 text-sm text-[#111113]/80 dark:text-[#f4f1e8]/80">
									{what}
								</p>
							</li>
						))}
					</ol>
					<TrackedLink
						href="/enterprise#contact"
						location="landing_bottom"
						cta="start_pilot"
						className="group mt-10 inline-flex items-center gap-2 rounded-full bg-amber-300 px-8 py-4 text-base font-semibold text-[#09090b] shadow-[0_0_0_1px_rgba(245,184,61,0.4),0_18px_50px_-12px_rgba(245,184,61,0.6)] transition-colors hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f1e8] dark:focus-visible:ring-offset-[#0d0d10]"
					>
						Start your 30-day pilot
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
					</TrackedLink>
				</div>
			</div>
		</section>
	);
}
