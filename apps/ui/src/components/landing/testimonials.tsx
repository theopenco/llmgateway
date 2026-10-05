import { TweetCard } from "@/lib/components/tweet-card";
import { TESTIMONIAL_TWEET_IDS } from "@/lib/testimonials";

export const Testimonials = async () => {
	return (
		<section className="relative overflow-hidden bg-surface-elevated py-24 md:py-32">
			<div className="absolute inset-0 bg-noise" />

			<div className="relative mx-auto max-w-7xl px-4 sm:px-6">
				<p className="mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
					Community
				</p>
				<h2 className="font-display text-4xl font-bold tracking-tight text-foreground md:text-5xl">
					What developers say
				</h2>

				<div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
					{TESTIMONIAL_TWEET_IDS.map((tweetId) => (
						<TweetCard
							key={tweetId}
							id={tweetId}
							className="w-full rounded-2xl border-border/50 shadow-sm transition-shadow hover:shadow-md"
						/>
					))}
				</div>
			</div>
		</section>
	);
};
