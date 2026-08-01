"use client";

import { ArrowRight } from "lucide-react";

import { AnimatedGroup } from "@/components/landing/animated-group";
import { Button } from "@/lib/components/button";
import { ShimmerButton } from "@/lib/components/shimmer-button";

import {
	AnthropicIcon,
	ClineIcon,
	CursorIcon,
	DevPassCodeIcon,
	OpenCodeIcon,
} from "@llmgateway/shared/components";

const APP_LOGOS: Array<{
	name: string;
	Icon: React.FC<React.SVGProps<SVGSVGElement>>;
}> = [
	{ name: "DevPass Code", Icon: DevPassCodeIcon },
	{ name: "Claude Code", Icon: AnthropicIcon },
	{ name: "Cursor", Icon: CursorIcon },
	{ name: "Cline", Icon: ClineIcon },
	{ name: "OpenCode", Icon: OpenCodeIcon },
];

export function DevPassUpsell() {
	return (
		<section className="relative overflow-hidden py-20 md:py-28">
			<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-blue-500/[0.07] dark:bg-blue-500/[0.05] rounded-full blur-3xl"
			/>

			<div className="container relative mx-auto px-4">
				<div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
					<AnimatedGroup preset="blur-slide" className="space-y-6">
						<div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
							Trusted by every app on this leaderboard
						</div>

						<h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-balance text-foreground">
							One key.
							<br />
							Every coding agent.
						</h2>

						<p className="max-w-xl text-base md:text-lg text-muted-foreground leading-relaxed">
							Stop juggling nine separate subscriptions. DevPass is{" "}
							<span className="text-foreground font-medium">
								one flat price
							</span>{" "}
							for Claude Code, Cursor, Cline, OpenCode, Aider, Continue, Zed —
							every tool above. Same key, every agent, anywhere you code.
						</p>

						<div className="flex items-center gap-6 pt-2">
							<div className="flex -space-x-3">
								{APP_LOGOS.map(({ name, Icon }) => (
									<div
										key={name}
										title={name}
										className="flex h-10 w-10 items-center justify-center rounded-full border bg-background ring-2 ring-background"
									>
										<Icon className="h-5 w-5" />
									</div>
								))}
							</div>
							<p className="text-sm text-muted-foreground">
								and 14+ more agents working today
							</p>
						</div>

						<div className="flex flex-wrap items-center gap-5 pt-3">
							<a
								href="https://devpass.llmgateway.io"
								target="_blank"
								rel="noopener noreferrer"
								className="group"
							>
								<ShimmerButton
									background="rgb(37, 99, 235)"
									className="shadow-2xl shadow-blue-500/25 px-8 md:px-10 py-3 md:py-4"
								>
									<span className="flex items-center gap-2 text-base md:text-lg font-bold tracking-tight text-white">
										Get DevPass
										<ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
									</span>
								</ShimmerButton>
							</a>
							<Button
								asChild
								variant="ghost"
								className="text-muted-foreground hover:text-foreground"
							>
								<a
									href="https://devpass.llmgateway.io/pricing"
									target="_blank"
									rel="noopener noreferrer"
								>
									See plans →
								</a>
							</Button>
						</div>
					</AnimatedGroup>

					<AnimatedGroup preset="blur-slide" className="lg:justify-self-end">
						<div className="relative w-full max-w-md">
							<div className="absolute -inset-2 rounded-2xl bg-blue-500/10 blur-xl" />
							<div className="relative rounded-xl border bg-background/80 shadow-2xl backdrop-blur">
								<div className="flex items-center justify-between border-b px-4 py-2.5">
									<div className="flex gap-1.5">
										<span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
										<span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
										<span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
									</div>
									<p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
										drop-in setup
									</p>
								</div>
								<pre className="overflow-x-auto p-5 text-xs leading-relaxed">
									<code className="font-mono">
										<span className="text-muted-foreground">
											{"# Claude Code\n"}
										</span>
										{"ANTHROPIC_BASE_URL="}
										<span className="text-blue-500">
											{"https://api.llmgateway.io"}
										</span>
										{"\nANTHROPIC_AUTH_TOKEN="}
										<span className="text-blue-500">{"llmgdev_***"}</span>
										{"\n\n"}
										<span className="text-muted-foreground">
											{"# Or any OpenAI-compatible tool\n"}
										</span>
										{"OPENAI_BASE_URL="}
										<span className="text-blue-500">
											{"https://api.llmgateway.io/v1"}
										</span>
									</code>
								</pre>
							</div>
						</div>
					</AnimatedGroup>
				</div>
			</div>

			<div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
		</section>
	);
}
