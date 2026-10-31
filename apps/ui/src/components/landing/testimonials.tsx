import { TweetCard, TweetSkeleton } from "@/lib/components/tweet-card";

import { MarqueeContainer } from "./marquee-container";

import type { ReactNode } from "react";

const row1Ids = [
	"2082200259560702374",
	"1970126770205757516",
	"1967955025315106997",
	"1952967806871605594",
	"1958630967700079065",
];

const row2Ids = [
	"1963180228991164808",
	"1969173545419767811",
	"1951594045824024934",
	"1958469139632464022",
];

const cardClassName =
	"w-full rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow";

function TestimonialsSection({
	renderCard,
}: {
	renderCard: (tweetId: string) => ReactNode;
}) {
	return (
		<section className="relative overflow-hidden py-24 md:py-32 bg-surface-elevated">
			{/* Noise texture */}
			<div className="absolute inset-0 bg-noise" />

			<div className="relative">
				<div className="mx-auto max-w-7xl px-6 lg:px-8 mb-16">
					<h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-foreground">
						Trusted by developers worldwide
					</h2>
				</div>

				<div className="space-y-6">
					{/* Row 1: scrolling left */}
					<MarqueeContainer>
						{row1Ids.map((tweetId) => (
							<div key={tweetId} className="shrink-0 w-80">
								{renderCard(tweetId)}
							</div>
						))}
					</MarqueeContainer>

					{/* Row 2: scrolling right */}
					<MarqueeContainer reverse>
						{row2Ids.map((tweetId) => (
							<div key={tweetId} className="shrink-0 w-80">
								{renderCard(tweetId)}
							</div>
						))}
					</MarqueeContainer>
				</div>
			</div>
		</section>
	);
}

// The cards fetch their tweets, so this suspends; render it behind
// TestimonialsFallback, which keeps the same layout.
export const Testimonials = () => (
	<TestimonialsSection
		renderCard={(tweetId) => (
			<TweetCard id={tweetId} className={cardClassName} />
		)}
	/>
);

// Loaded cards are h-64 (MagicTweet); match it so the rows keep their height.
export const TestimonialsFallback = () => (
	<TestimonialsSection
		renderCard={() => (
			<TweetSkeleton className={`${cardClassName} h-64 max-h-none`} />
		)}
	/>
);
