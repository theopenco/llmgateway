"use client";
import { DiscordLogoIcon } from "@radix-ui/react-icons";
import { GithubIcon, TwitterIcon } from "lucide-react";
import Link from "next/link";

import { useAppConfig } from "@/lib/config";
import Logo from "@/lib/icons/Logo";

import { providers as providerDefinitions } from "@llmgateway/models";

export default function Footer() {
	const config = useAppConfig();
	const filteredProviders = providerDefinitions.filter(
		(p) => p.name !== "LLM Gateway",
	);

	return (
		<footer className="border-t border-zinc-200 dark:border-zinc-800 py-12 bg-white dark:bg-black">
			<div className="container mx-auto px-4">
				<div className="flex flex-col md:flex-row md:justify-between md:items-start">
					<div className="mb-6 md:mb-0">
						<div className="flex items-center space-x-2">
							<Logo className="h-8 w-8 rounded-full text-black dark:text-white" />
							<span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
								LLM Gateway
							</span>
						</div>
						<p className="text-zinc-600 dark:text-zinc-500 text-sm mt-2">
							© {new Date().getFullYear()} LLM Gateway. All rights reserved.
						</p>
						<div className="flex items-center space-x-4 mt-4">
							<a
								href={config.githubUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
								aria-label="GitHub"
							>
								<GithubIcon className="h-5 w-5" />
							</a>
							<a
								href={config.twitterUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
								aria-label="Twitter"
							>
								<TwitterIcon className="h-5 w-5" />
							</a>
							<a
								href={config.discordUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
								aria-label="Discord"
							>
								<DiscordLogoIcon className="h-5 w-5" />
							</a>
						</div>
					</div>

					<div className="w-full md:w-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 text-zinc-700 dark:text-zinc-400">
						<div>
							<h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-white">
								Product
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href="#features"
										className="text-sm hover:text-black dark:hover:text-white"
									>
										Features
									</a>
								</li>
								<li>
									<Link
										href="/models"
										className="text-sm hover:text-black dark:hover:text-white"
										prefetch={true}
									>
										Models
									</Link>
								</li>
								<li>
									<Link
										href="/providers"
										className="text-sm hover:text-black dark:hover:text-white"
										prefetch={true}
									>
										Providers
									</Link>
								</li>
								<li>
									<a
										href={config.playgroundUrl}
										className="text-sm hover:text-black dark:hover:text-white"
										rel="noopener noreferrer"
										target="_blank"
									>
										Chat Playground
									</a>
								</li>
								<li>
									<Link
										href="/changelog"
										className="text-sm hover:text-black dark:hover:text-white"
										prefetch={true}
									>
										Changelog
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-white">
								Resources
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href={config.docsUrl ?? ""}
										target="_blank"
										className="text-sm hover:text-black dark:hover:text-white"
									>
										Documentation
									</a>
								</li>
								<li>
									<a
										href={config.githubUrl ?? ""}
										target="_blank"
										className="text-sm hover:text-black dark:hover:text-white"
									>
										GitHub
									</a>
								</li>
								<li>
									<a
										href="mailto:contact@llmgateway.io"
										target="_blank"
										className="text-sm hover:text-black dark:hover:text-white"
									>
										Contact Us
									</a>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-white">
								Community
							</h3>
							<ul className="space-y-2">
								<li>
									<a
										href={config.twitterUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:text-black dark:hover:text-white"
									>
										Twitter
									</a>
								</li>
								<li>
									<a
										href={config.discordUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-sm hover:text-black dark:hover:text-white"
									>
										Discord
									</a>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-white">
								Compare
							</h3>
							<ul className="space-y-2">
								<li>
									<Link
										href="/compare/open-router"
										className="text-sm hover:text-black dark:hover:text-white"
										prefetch={true}
									>
										OpenRouter
									</Link>
								</li>
							</ul>
						</div>

						<div>
							<h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-white">
								Providers
							</h3>
							<ul className="space-y-2">
								{filteredProviders.map((provider) => (
									<li key={provider.id}>
										<Link
											href={`/providers/${provider.id}`}
											className="text-sm hover:text-black dark:hover:text-white"
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
			</div>
		</footer>
	);
}
