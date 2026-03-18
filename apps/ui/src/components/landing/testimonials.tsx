import { TweetCard } from "@/lib/components/tweet-card";

import { MarqueeContainer } from "./marquee-container";

const row1Ids = [
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

export const Testimonials = async () => {
	return (
		<section className="relative overflow-hidden py-24 md:py-32 bg-surface-elevated">
			{/* Noise texture */}
			<div className="absolute inset-0 bg-noise" />

			<div className="relative">
				<div className="mx-auto max-w-7xl px-6 lg:px-8 mb-16">
					<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-4">
						Community
					</p>
					<h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-foreground">
						Trusted by developers worldwide
					</h2>
				</div>

				<div className="space-y-6">
					{/* Row 1: scrolling left */}
					<MarqueeContainer>
						{row1Ids.map((tweetId) => (
							<div key={tweetId} className="shrink-0 w-80">
								<TweetCard
									id={tweetId}
									className="w-full rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow"
								/>
							</div>
						))}
					</MarqueeContainer>

					{/* Row 2: scrolling right */}
					<MarqueeContainer reverse>
						{row2Ids.map((tweetId) => (
							<div key={tweetId} className="shrink-0 w-80">
								<TweetCard
									id={tweetId}
									className="w-full rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow"
								/>
							</div>
						))}
					</MarqueeContainer>
				</div>
			</div>
		</section>
	);
};
