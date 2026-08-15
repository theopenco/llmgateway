"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type RailVariant = "devpass" | "gateway";

interface ContentConversionRailProps {
	/** Which offer to stand behind. Coding-agent content gets DevPass. */
	variant?: RailVariant;
	/** Surface name for analytics — "blog", "guide", "timeline". */
	surface: string;
	/**
	 * Model slug to deep-link when the reader is on a page about one specific
	 * model. Falls back to the full catalogue.
	 */
	model?: string;
}

const DISMISS_KEY = "llmgateway-rail-dismissed";

// Reveal once the reader is past the opening, so the rail reads as a follow-up
// rather than an interstitial on arrival.
const REVEAL_AT = 0.28;

export function ContentConversionRail({
	variant = "gateway",
	surface,
	model,
}: ContentConversionRailProps) {
	const posthog = usePostHog();
	const pathname = usePathname();
	const [visible, setVisible] = useState(false);
	const [dismissed, setDismissed] = useState(true);
	const [cardOnScreen, setCardOnScreen] = useState(false);
	const shownRef = useRef(false);

	// Read the dismissal after mount so the server and client markup agree.
	useEffect(() => {
		try {
			setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
		} catch {
			setDismissed(false);
		}
	}, []);

	useEffect(() => {
		if (dismissed) {
			return;
		}
		const onScroll = () => {
			const scrollable = document.body.scrollHeight - window.innerHeight;
			if (scrollable <= 0) {
				return;
			}
			setVisible(window.scrollY / scrollable >= REVEAL_AT);
		};
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, [dismissed]);

	// Stand down while any inline offer is on screen — a blog card, or the
	// timeline's own CTA block. Two offers competing in the same viewport reads
	// as pressure, and the inline one is the better of the two.
	useEffect(() => {
		const cards = document.querySelectorAll("[data-inline-cta]");
		if (!cards.length || typeof IntersectionObserver === "undefined") {
			return;
		}
		const seen = new Set<Element>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						seen.add(entry.target);
					} else {
						seen.delete(entry.target);
					}
				}
				setCardOnScreen(seen.size > 0);
			},
			{ rootMargin: "-10% 0px" },
		);
		cards.forEach((card) => observer.observe(card));
		return () => observer.disconnect();
	}, []);

	const showing = visible && !dismissed && !cardOnScreen;

	useEffect(() => {
		if (showing && !shownRef.current) {
			shownRef.current = true;
			posthog.capture("conversion_rail_shown", { surface, variant });
		}
	}, [showing, posthog, surface, variant]);

	const dismiss = useCallback(() => {
		setDismissed(true);
		try {
			localStorage.setItem(DISMISS_KEY, "1");
		} catch {
			// A blocked storage write only costs us the persistence.
		}
		posthog.capture("conversion_rail_dismissed", { surface, variant });
	}, [posthog, surface, variant]);

	const track = (cta: string) => {
		posthog.capture("cta_clicked", {
			location: `rail_${surface}`,
			cta,
			variant,
			path: pathname,
		});
	};

	const isDevPass = variant === "devpass";
	const href = isDevPass
		? "https://devpass.llmgateway.io/pricing?utm_source=content&utm_medium=rail"
		: model
			? `/models/${model}`
			: "/models";

	return (
		<div
			aria-hidden={!showing}
			inert={!showing || undefined}
			className={cn(
				"pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-3 sm:pb-4",
				// Extra right inset on small screens keeps the card clear of the
				// floating support bubble, which otherwise covers the dismiss button.
				"pl-3 pr-16 sm:px-3",
				"transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none",
				showing
					? "translate-y-0 opacity-100"
					: "pointer-events-none translate-y-3 opacity-0",
			)}
		>
			<div
				className={cn(
					"pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-xl px-3 py-2.5 sm:gap-4 sm:px-4",
					"border border-dashed border-stone-400/70 bg-stone-50/90 backdrop-blur",
					"shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)]",
					"dark:border-stone-600/70 dark:bg-stone-900/90",
				)}
			>
				<div className="min-w-0 flex-1">
					{/* The eyebrow is a nicety on desktop and a space tax on a phone. */}
					<div className="hidden font-mono text-[9px] uppercase tracking-[0.3em] text-stone-500 sm:block dark:text-stone-400">
						{isDevPass ? "DevPass" : "LLM Gateway"}
					</div>
					<p className="truncate text-[13px] font-medium leading-snug text-foreground sm:mt-0.5 sm:text-sm">
						{isDevPass ? "Every model, one flat rate" : "One key, every model"}
					</p>
				</div>

				{/* Perforation, echoing the boarding-pass card this follows. */}
				<div
					aria-hidden
					className="hidden h-8 w-px shrink-0 border-l border-dashed border-stone-400/70 dark:border-stone-600/70 sm:block"
				/>

				<Link
					href={href}
					prefetch={isDevPass ? undefined : true}
					onClick={() => track(isDevPass ? "get_devpass" : "browse_models")}
					className={cn(
						"group/rail inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5",
						"bg-zinc-900 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700",
						"dark:bg-white dark:text-black dark:hover:bg-zinc-200",
					)}
				>
					<span className="sm:hidden">{isDevPass ? "Plans" : "Models"}</span>
					<span className="hidden sm:inline">
						{isDevPass
							? "See plans"
							: model
								? "Try this model"
								: "Browse models"}
					</span>
					<ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover/rail:translate-x-0.5 motion-reduce:transition-none" />
				</Link>

				<button
					type="button"
					onClick={dismiss}
					aria-label="Dismiss"
					className="shrink-0 rounded-md p-1 text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:text-stone-400 dark:hover:bg-stone-800"
				>
					<X className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}
