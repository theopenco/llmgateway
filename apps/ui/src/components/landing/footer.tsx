"use client";
import { DiscordLogoIcon } from "@radix-ui/react-icons";
import { GithubIcon } from "lucide-react";
import Link from "next/link";

import { useAppConfig } from "@/lib/config";
import Logo from "@/lib/icons/Logo";
import { XIcon } from "@/lib/icons/XIcon";

import { providers as providerDefinitions } from "@llmgateway/models";

export default function Footer() {
	const config = useAppConfig();
	const filteredProviders = providerDefinitions.filter(
		(p) => p.name !== "LLM Gateway",
	);

	return (
		<footer className="relative py-12 bg-background">
			{/* Gradient separator */}
			<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

			<div className="container mx-auto px-4">
				<div className="flex flex-col md:flex-row md:justify-between md:items-start">
					<div className="mb-6 md:mb-0">
						<div className="flex items-center space-x-2">
							<Logo className="h-8 w-8 rounded-full text-black dark:text-white" />
							<span className="font-display text-lg font-bold tracking-tight text-foreground">
								LLM Gateway
							</span>
						</div>
						<div className="flex items-center space-x-4 mt-4">
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
								<XIcon className="h-5 w-5" />
							</a>
							<a
								href={config.discordUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-foreground transition-colors"
								aria-label="Discord"
							>
								<DiscordLogoIcon className="h-5 w-5" />
							</a>
						</div>
					</div>

					<div className="w-full md:w-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8 text-muted-foreground">
						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Product
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href="#features"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Features
									</a>
								</li>
								<li>
									<Link
										href="/models"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Models
									</Link>
								</li>
								<li>
									<Link
										href="/providers"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Providers
									</Link>
								</li>
								<li>
									<a
										href={config.playgroundUrl}
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										rel="noopener noreferrer"
										target="_blank"
									>
										Chat Playground
									</a>
								</li>
								<li>
									<Link
										href="/changelog"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Changelog
									</Link>
								</li>
								<li>
									<Link
										href="/models/compare"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Compare Models
									</Link>
								</li>
								<li>
									<Link
										href="/enterprise"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Enterprise
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Resources
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/templates"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Templates
									</Link>
								</li>
								<li>
									<Link
										href="/agents"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Agents
									</Link>
								</li>
								<li>
									<Link
										href="/mcp"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										MCP Server
									</Link>
								</li>
								<li>
									<Link
										href="/blog"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Blog
									</Link>
								</li>
								<li>
									<a
										href={config.docsUrl ?? ""}
										target="_blank"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Documentation
									</a>
								</li>
								<li>
									<Link
										href={"/integrations" as any}
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Integrations
									</Link>
								</li>
								<li>
									<Link
										href={"/guides" as any}
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Guides
									</Link>
								</li>
								<li>
									<Link
										href={"/brand" as any}
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Brand Assets
									</Link>
								</li>
								<li>
									<Link
										href="/cost-simulator"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch
									>
										Cost Simulator
									</Link>
								</li>
								<li>
									<Link
										href="/referrals"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Referral Program
									</Link>
								</li>
								<li>
									<a
										href={config.githubUrl ?? ""}
										target="_blank"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										GitHub
									</a>
								</li>
								<li>
									<a
										href="mailto:contact@llmgateway.io"
										target="_blank"
										rel="noreferrer noopener"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Contact Us
									</a>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Community
							</h3>
							<ul className="space-y-2">
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
										href={config.discordUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
									>
										Discord
									</a>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Compare
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/compare/open-router"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										OpenRouter
									</Link>
								</li>
								<li>
									<Link
										href={"/compare/litellm" as any}
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										LiteLLM
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Models
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/models/text"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Text Generation
									</Link>
								</li>
								<li>
									<Link
										href="/models/text-to-image"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Text to Image
									</Link>
								</li>
								<li>
									<Link
										href="/models/image-to-image"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Image to Image
									</Link>
								</li>
								<li>
									<Link
										href="/models/vision"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Vision
									</Link>
								</li>
								<li>
									<Link
										href="/models/reasoning"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Reasoning
									</Link>
								</li>
								<li>
									<Link
										href="/models/tools"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Tool Calling
									</Link>
								</li>
								<li>
									<Link
										href="/models/web-search"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Web Search
									</Link>
								</li>
								<li>
									<Link
										href="/models/discounted"
										className="text-sm hover:underline underline-offset-4 hover:text-foreground"
										prefetch={true}
									>
										Discounted
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="font-display text-sm font-semibold mb-4 text-foreground">
								Providers
							</h3>
							<ul className="space-y-2">
								{filteredProviders.map((provider) => (
									<li key={provider.id}>
										<Link
											href={`/providers/${provider.id}`}
											className="text-sm hover:underline underline-offset-4 hover:text-foreground"
											prefetch={true}
										>
											{provider.name}
										</Link>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>

				{/* Bottom bar */}
				<div className="border-t border-border/50 pt-8 mt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						&copy; {new Date().getFullYear()} LLM Gateway. All rights reserved.
					</p>
					<div className="flex items-center gap-6">
						<a
							href="https://status.llmgateway.io/"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							<span className="relative flex h-2.5 w-2.5">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
								<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
							</span>
							All systems operational
						</a>
						<Link
							href="/legal/privacy"
							className="text-sm text-muted-foreground hover:underline underline-offset-4 hover:text-foreground"
							prefetch={true}
						>
							Privacy Policy
						</Link>
						<Link
							href="/legal/terms"
							className="text-sm text-muted-foreground hover:underline underline-offset-4 hover:text-foreground"
							prefetch={true}
						>
							Terms of Use
						</Link>
					</div>
				</div>
			</div>
		</footer>
	);
}
