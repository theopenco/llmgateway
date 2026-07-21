"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";

import { Button } from "@/lib/components/button";

// Conversion card embeddable in markdown content via the `BlogCta` override in
// getMarkdownOptions. The DevPass variant leans into the passport/boarding-pass
// brand language used across DevPass surfaces.
export function BlogCta({
	variant = "devpass",
	location = "inline",
}: {
	variant?: "devpass" | "gateway";
	location?: string;
}) {
	const posthog = usePostHog();
	const pathname = usePathname();
	const post = pathname?.split("/").pop() ?? "unknown";

	const track = (cta: string) => {
		posthog.capture("cta_clicked", {
			location: `blog_${location}`,
			cta,
			post,
		});
	};

	if (variant === "gateway") {
		return (
			<div className="not-prose my-10 rounded-xl border bg-muted/30 p-6 sm:p-8">
				<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
					LLM Gateway
				</div>
				<h3 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
					One API key for every model.
				</h3>
				<p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
					Route to 200+ models with automatic failover, caching, and real-time
					cost analytics. Free to start — no credit card required.
				</p>
				<div className="mt-5 flex flex-wrap items-center gap-3">
					<Button
						asChild
						className="bg-zinc-900 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
					>
						<Link
							href="/signup"
							prefetch={true}
							onClick={() => track("create_free_account")}
						>
							Create free account
						</Link>
					</Button>
					<Link
						href="/models"
						prefetch={true}
						onClick={() => track("browse_models")}
						className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
					>
						Browse all models
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="not-prose relative my-10 overflow-hidden rounded-xl border border-dashed border-stone-400/70 bg-stone-50/70 dark:border-stone-600/70 dark:bg-stone-900/30">
			<div className="p-6 sm:p-8">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
						DevPass · Boarding pass
					</div>
					<div className="font-mono text-[9px] tracking-[0.25em] text-stone-400 dark:text-stone-500">
						No. DP-{post.slice(0, 6).toUpperCase()}
					</div>
				</div>
				<h3 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
					Every frontier model. One flat rate.
				</h3>
				<p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
					Run Claude, GPT-5.5, Gemini, and 200+ more through Claude Code,
					Cursor, or whatever tool you already use. From $29/mo — no token math,
					no surprise invoices.
				</p>
				<div className="mt-5 flex flex-wrap items-center gap-3">
					<Button
						asChild
						className="bg-zinc-900 font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
					>
						<a
							href={`https://devpass.llmgateway.io/signup?utm_source=blog&utm_medium=cta&utm_campaign=${post}`}
							onClick={() => track("get_devpass")}
						>
							Get DevPass — from $29/mo
						</a>
					</Button>
					<a
						href={`https://devpass.llmgateway.io/pricing?utm_source=blog&utm_medium=cta&utm_campaign=${post}`}
						onClick={() => track("compare_devpass_plans")}
						className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
					>
						Compare plans
					</a>
				</div>
			</div>
		</div>
	);
}
