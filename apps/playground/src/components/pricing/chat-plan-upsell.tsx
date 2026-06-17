"use client";

import { Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { ChatPricingPlans } from "@/components/pricing/chat-pricing-plans";

type StudioNoun = "images" | "videos" | "audio";

interface ChatPlanUpsellProps {
	noun: StudioNoun;
	isAuthenticated: boolean;
	/** When true the user already has a plan but ran out of cycle credits. */
	subscribed?: boolean;
}

const HEADLINE: Record<StudioNoun, string> = {
	images: "Pick a plan to keep generating images",
	videos: "Pick a plan to keep generating videos",
	audio: "Pick a plan to keep generating audio",
};

export function ChatPlanUpsell({
	noun,
	isAuthenticated,
	subscribed = false,
}: ChatPlanUpsellProps) {
	const headline = subscribed
		? "You've used this cycle's credits — upgrade to keep going"
		: HEADLINE[noun];

	return (
		<div className="relative mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
			{/* Atmospheric glow behind the header — theme-aware, very subtle. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 -top-8 mx-auto h-64 max-w-3xl rounded-full opacity-70 blur-3xl"
				style={{
					background:
						"radial-gradient(60% 60% at 50% 40%, color-mix(in oklab, var(--foreground) 9%, transparent), transparent 70%)",
				}}
			/>

			<motion.div
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
				className="relative mb-9 text-center"
			>
				<div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-foreground/[0.04] px-3 py-1 text-xs font-medium text-foreground/80">
					<Sparkles className="h-3.5 w-3.5" />
					Up to 3× the value you pay for
				</div>
				<h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
					{headline}
				</h2>
				<p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
					One subscription powers every studio — chat, images, video, and audio.
					Each plan gives you more usage than you pay for, every cycle, across
					every model.
				</p>
			</motion.div>

			<motion.div
				initial={{ opacity: 0, y: 24 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
			>
				<ChatPricingPlans isAuthenticated={isAuthenticated} />
			</motion.div>
		</div>
	);
}
