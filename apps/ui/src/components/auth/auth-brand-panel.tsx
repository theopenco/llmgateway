import { Zap, Shield, Globe } from "lucide-react";

import { TweetCard } from "@/lib/components/tweet-card";

const TWEET_IDS = [
	"1970126770205757516",
	"1967955025315106997",
	"1952967806871605594",
	"1958630967700079065",
	"1963180228991164808",
	"1969173545419767811",
	"1951594045824024934",
	"1958469139632464022",
];

function pickRandom<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

export async function AuthBrandPanel({
	variant,
}: {
	variant: "login" | "signup";
}) {
	const tweetId = pickRandom(TWEET_IDS);

	return (
		<div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 lg:flex lg:flex-col lg:justify-between">
			{/* Decorative grid */}
			<div
				className="absolute inset-0 opacity-[0.03]"
				style={{
					backgroundImage:
						"linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
					backgroundSize: "64px 64px",
				}}
			/>
			{/* Gradient orbs */}
			<div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-[128px]" />
			<div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary/10 blur-[128px]" />

			<div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
				<div>
					<p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">
						LLM Gateway
					</p>
					{variant === "signup" ? (
						<>
							<h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
								One API for
								<br />
								every LLM.
							</h1>
							<p className="mt-4 max-w-md text-lg text-zinc-400">
								Route requests across providers, cut costs with smart caching,
								and ship AI features without vendor lock-in.
							</p>
						</>
					) : (
						<>
							<h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
								Welcome back.
							</h1>
							<p className="mt-4 max-w-md text-lg text-zinc-400">
								Pick up where you left off. Your AI infrastructure is running
								smoothly.
							</p>
						</>
					)}
				</div>

				{variant === "signup" && (
					<div className="mt-12 grid grid-cols-3 gap-6">
						<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
							<Zap className="mb-2 h-5 w-5 text-primary" />
							<p className="text-2xl font-bold tabular-nums text-white">50M+</p>
							<p className="text-xs text-zinc-500">API calls routed</p>
						</div>
						<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
							<Shield className="mb-2 h-5 w-5 text-primary" />
							<p className="text-2xl font-bold tabular-nums text-white">
								99.9%
							</p>
							<p className="text-xs text-zinc-500">Uptime SLA</p>
						</div>
						<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
							<Globe className="mb-2 h-5 w-5 text-primary" />
							<p className="text-2xl font-bold tabular-nums text-white">15+</p>
							<p className="text-xs text-zinc-500">LLM providers</p>
						</div>
					</div>
				)}

				{/* Real tweet from our community */}
				<div className="mt-8">
					<TweetCard
						id={tweetId}
						className="w-full rounded-xl border-zinc-700/50 bg-zinc-800/30 shadow-none [&_a]:text-zinc-400 [&_img]:border-zinc-700"
					/>
				</div>
			</div>

			<div className="relative z-10 px-12 pb-8 xl:px-16">
				<p className="text-xs text-zinc-600">
					Trusted by developers building AI-powered applications
				</p>
			</div>
		</div>
	);
}
