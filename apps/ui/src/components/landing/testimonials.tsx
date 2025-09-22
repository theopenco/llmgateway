import { TweetCard } from "@/lib/components/tweet-card";

const tweetIds = [
	"1970126770205757516",
	"1967955025315106997",
	"1952967806871605594",
	"1958630967700079065",
	"1963180228991164808",
	"1969173545419767811",
	"1951594045824024934",
	"1958469139632464022",
];

export const Testimonials = async () => {
	return (
		<section className="relative overflow-hidden py-16 bg-background">
			<div className="mx-auto max-w-7xl px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
						What developers are saying
					</h2>
					<p className="mt-4 text-lg leading-8 text-gray-600 dark:text-gray-300">
						See what the community thinks about our LLM Gateway
					</p>
				</div>

				<div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-8 lg:mx-0 lg:max-w-none lg:grid-cols-2 xl:grid-cols-4">
					{tweetIds.map((tweetId) => (
						<div key={tweetId} className="flex justify-center">
							<TweetCard id={tweetId} className="w-full max-w-md" />
						</div>
					))}
				</div>
			</div>
		</section>
	);
};
