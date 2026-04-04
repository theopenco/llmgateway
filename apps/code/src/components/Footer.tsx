"use client";

import { Code, GithubIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

function Newsletter() {
	const [email, setEmail] = useState("");
	const api = useApi();
	const subscribe = api.useMutation("post", "/public/newsletter/subscribe");

	return (
		<div className="relative rounded-2xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted/20 overflow-hidden mb-12">
			<div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
			<div className="relative px-6 py-10 sm:px-10 sm:py-12">
				{subscribe.isSuccess ? (
					<div className="flex flex-col items-center gap-4 text-center py-2">
						<div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 ring-1 ring-green-500/20">
							<svg
								className="h-6 w-6 text-green-500"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M5 13l4 4L19 7"
								/>
							</svg>
						</div>
						<div className="space-y-1">
							<h3 className="text-xl font-bold">You&apos;re in!</h3>
							<p className="text-sm text-muted-foreground max-w-sm mx-auto">
								{subscribe.data?.message ??
									"Check your inbox — we'll send you the good stuff, no filler."}
							</p>
						</div>
					</div>
				) : (
					<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8 md:gap-12">
						<div className="flex-1 max-w-lg space-y-3">
							<p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
								Newsletter
							</p>
							<h3 className="text-xl sm:text-2xl font-bold tracking-tight">
								Stay ahead of the curve
							</h3>
							<p className="text-sm text-muted-foreground leading-relaxed max-w-md">
								Join developers who get weekly insights on new models, cost
								optimization, and AI coding tips — straight to their inbox.
							</p>
						</div>
						<div className="w-full md:w-auto md:min-w-[300px]">
							<form
								className="flex flex-col gap-3"
								onSubmit={(e) => {
									e.preventDefault();
									if (subscribe.isPending) {
										return;
									}
									subscribe.mutate({ body: { email } });
								}}
							>
								<Input
									type="email"
									placeholder="you@company.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
									className="h-11 rounded-xl bg-background/80"
								/>
								<Button
									type="submit"
									disabled={subscribe.isPending}
									className="h-11 rounded-xl"
								>
									{subscribe.isPending
										? "Subscribing..."
										: "Subscribe — it's free"}
								</Button>
								<p className="text-[11px] text-muted-foreground/60 text-center">
									No spam. Unsubscribe anytime.
								</p>
							</form>
							{subscribe.isError && (
								<p className="mt-2 text-sm text-destructive text-center">
									Something went wrong. Please try again.
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export function Footer() {
	const config = useAppConfig();

	return (
		<footer className="relative border-t py-12 px-4">
			<div className="container mx-auto max-w-5xl">
				<Newsletter />

				<div className="flex flex-col md:flex-row md:justify-between md:items-start gap-8">
					<div>
						<Link href="/" className="flex items-center gap-2">
							<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
								<Code className="h-4 w-4" />
							</div>
							<span className="font-semibold">DevPass</span>
						</Link>
						<div className="flex items-center gap-3 mt-4">
							<a
								href={config.githubUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-foreground transition-colors"
								aria-label="GitHub"
							>
								<GithubIcon className="h-5 w-5" />
							</a>
							<a
								href={config.twitterUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-foreground transition-colors"
								aria-label="X"
							>
								<svg
									className="h-5 w-5"
									viewBox="0 0 24 24"
									fill="currentColor"
								>
									<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
								</svg>
							</a>
							<a
								href={config.discordUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-foreground transition-colors"
								aria-label="Discord"
							>
								<svg
									className="h-5 w-5"
									viewBox="0 0 24 24"
									fill="currentColor"
								>
									<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
								</svg>
							</a>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-8 text-muted-foreground sm:grid-cols-3">
						<div>
							<h3 className="text-sm font-semibold mb-4 text-foreground">
								Product
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href={`${config.uiUrl}/models`}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Models
									</a>
								</li>
								<li>
									<Link
										href="/#pricing"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Pricing
									</Link>
								</li>
								<li>
									<a
										href={config.uiUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										LLM Gateway
									</a>
								</li>
							</ul>
						</div>
						<div>
							<h3 className="text-sm font-semibold mb-4 text-foreground">
								Resources
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href={config.docsUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Documentation
									</a>
								</li>
								<li>
									<a
										href={`${config.uiUrl}/integrations`}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Integrations
									</a>
								</li>
								<li>
									<a
										href={`${config.uiUrl}/blog`}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Blog
									</a>
								</li>
							</ul>
						</div>
						<div>
							<h3 className="text-sm font-semibold mb-4 text-foreground">
								Community
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href={config.discordUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Discord
									</a>
								</li>
								<li>
									<a
										href={config.twitterUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Twitter
									</a>
								</li>
								<li>
									<a
										href={config.githubUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										GitHub
									</a>
								</li>
							</ul>
						</div>
					</div>
				</div>

				<div className="border-t border-border/50 pt-8 mt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						&copy; {new Date().getFullYear()} LLM Gateway. All rights reserved.
					</p>
					<div className="flex items-center gap-6">
						<a
							href={`${config.uiUrl}/legal/privacy`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm text-muted-foreground hover:underline underline-offset-4 hover:text-foreground"
						>
							Privacy Policy
						</a>
						<a
							href={`${config.uiUrl}/legal/terms`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm text-muted-foreground hover:underline underline-offset-4 hover:text-foreground"
						>
							Terms of Use
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
