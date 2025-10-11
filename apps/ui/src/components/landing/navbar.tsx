"use client";
import { Menu, X, Github } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
} from "@/lib/components/navigation-menu";
import { useAppConfig } from "@/lib/config";
import Logo from "@/lib/icons/Logo";
import { cn } from "@/lib/utils";

import { ThemeToggle } from "./theme-toggle";

import type { ReactNode } from "react";

function ListItem({
	title,
	href,
	children,
	external,
}: {
	title: string;
	href: string;
	children: ReactNode;
	external?: boolean;
}) {
	return (
		<li>
			<NavigationMenuLink asChild>
				{external ? (
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
					>
						<div className="text-sm font-medium leading-none">{title}</div>
						<p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
							{children}
						</p>
					</a>
				) : (
					<Link
						href={href}
						prefetch={true}
						className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
					>
						<div className="text-sm font-medium leading-none">{title}</div>
						<p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
							{children}
						</p>
					</Link>
				)}
			</NavigationMenuLink>
		</li>
	);
}

export const Navbar = ({ children }: { children?: React.ReactNode }) => {
	const config = useAppConfig();

	const menuItems = [
		{ name: "Pricing", href: "/#pricing" },
		{ name: "Docs", href: config.docsUrl ?? "", external: true },
		{ name: "Models", href: "/models" },
	];

	const resourcesItems = [
		{ name: "Blog", href: "/blog" },
		{ name: "Changelog", href: "/changelog" },
		{
			name: "Chat",
			href:
				process.env.NODE_ENV === "development"
					? "http://localhost:3003"
					: "https://chat.llmgateway.io",
		},
		{ name: "Providers", href: "/providers" },
		{ name: "Docs", href: config.docsUrl ?? "", external: true },
		{ name: "Compare", href: "/models/compare" },
		{ name: "Contact Us", href: "mailto:contact@llmgateway.io" },
	];

	const resourcesLinks: Array<{
		title: string;
		href: string;
		description: string;
		external?: boolean;
	}> = [
		{
			title: "Blog",
			href: "/blog",
			description: "Product updates, tutorials, benchmarks, and announcements.",
		},
		{
			title: "Chat",
			href:
				process.env.NODE_ENV === "development"
					? "http://localhost:3003"
					: "https://chat.llmgateway.io",
			description:
				"Try models in your browser with streaming and more features.",
		},
		{
			title: "Docs",
			href: config.docsUrl ?? "#",
			description:
				"Guides, API reference, and examples to get you shipping fast.",
			external: true,
		},
		{
			title: "Compare",
			href: "/models/compare",
			description: "Compare models side by side",
		},
		{
			title: "Changelog",
			href: "/changelog",
			description: "What’s new in LLM Gateway across releases.",
		},
		{
			title: "Providers",
			href: "/providers",
			description: "Connect and manage your provider API keys.",
		},
	];

	const [menuState, setMenuState] = useState(false);
	const [isScrolled, setIsScrolled] = useState(false);

	useEffect(() => {
		const handleScroll = () => {
			setIsScrolled(window.scrollY > 50);
		};
		window.addEventListener("scroll", handleScroll);
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<header>
			<nav
				data-state={menuState && "active"}
				className="fixed z-20 w-full px-2 group"
			>
				<div
					className={cn(
						"mx-auto mt-2 max-w-6xl px-6 transition-all duration-300 lg:px-12",
						isScrolled &&
							"bg-background/50 max-w-6xl rounded-2xl border backdrop-blur-lg lg:px-5",
					)}
				>
					<div className="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
						{/* Logo and Title */}
						<div className="flex w-full justify-between lg:w-auto">
							<Link
								href="/"
								aria-label="home"
								className="flex items-center space-x-2"
								prefetch={true}
							>
								<Logo className="h-8 w-8 rounded-full text-black dark:text-white" />
								<span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
									LLM Gateway
								</span>
							</Link>

							<button
								onClick={() => setMenuState(!menuState)}
								aria-label={menuState ? "Close Menu" : "Open Menu"}
								className="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 lg:hidden"
							>
								<Menu className="group-data-[state=active]:scale-0 group-data-[state=active]:opacity-0 size-6 duration-200" />
								<X className="absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 group-data-[state=active]:rotate-0 group-data-[state=active]:scale-100 group-data-[state=active]:opacity-100 duration-200" />
							</button>
						</div>

						<div className="m-auto hidden size-fit lg:block">
							<NavigationMenu viewport={false}>
								<NavigationMenuList className="flex gap-2 text-sm">
									{menuItems.map((item, index) => (
										<NavigationMenuItem key={index}>
											{item.external ? (
												<NavigationMenuLink asChild>
													<a
														href={item.href}
														target="_blank"
														rel="noopener noreferrer"
														className="text-muted-foreground hover:text-accent-foreground block duration-150 px-4 py-2"
													>
														{item.name}
													</a>
												</NavigationMenuLink>
											) : (
												<NavigationMenuLink asChild>
													<Link
														href={item.href}
														className="text-muted-foreground hover:text-accent-foreground block duration-150 px-4 py-2"
														prefetch={true}
													>
														{item.name}
													</Link>
												</NavigationMenuLink>
											)}
										</NavigationMenuItem>
									))}

									<NavigationMenuItem>
										<NavigationMenuTrigger className="text-muted-foreground hover:text-accent-foreground px-4 py-2">
											Resources
										</NavigationMenuTrigger>
										<NavigationMenuContent>
											<ul className="grid gap-3 p-6 md:w-[480px] lg:w-[640px] lg:grid-cols-[.8fr_1fr]">
												<li className="row-span-3">
													<NavigationMenuLink asChild>
														<a
															className="flex h-full w-full select-none flex-col justify-end rounded-md bg-gradient-to-b from-muted/50 to-muted p-6 no-underline outline-none focus:shadow-md"
															href={
																config.docsUrl
																	? `${config.docsUrl}/quick-start`
																	: "#"
															}
															target={config.docsUrl ? "_blank" : undefined}
															rel={
																config.docsUrl
																	? "noopener noreferrer"
																	: undefined
															}
														>
															<div className="mb-2 mt-4 text-lg font-medium">
																Quick Start
															</div>
															<p className="text-sm leading-tight text-muted-foreground">
																Get started in minutes. Install, configure
																providers, and call the API.
															</p>
														</a>
													</NavigationMenuLink>
												</li>
												{resourcesLinks.map((link) => (
													<ListItem
														key={link.title}
														title={link.title}
														href={link.href}
														external={link.external}
													>
														{link.description}
													</ListItem>
												))}
											</ul>
										</NavigationMenuContent>
									</NavigationMenuItem>
								</NavigationMenuList>
							</NavigationMenu>
						</div>

						<div className="bg-background group-data-[state=active]:block lg:group-data-[state=active]:flex mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent">
							<div className="lg:hidden">
								<ul className="space-y-6 text-base">
									{menuItems.map((item, index) => (
										<li key={index}>
											{item.external ? (
												<a
													href={item.href}
													target="_blank"
													rel="noopener noreferrer"
													className="text-muted-foreground hover:text-accent-foreground block duration-150"
												>
													{item.name}
												</a>
											) : (
												<Link
													href={item.href}
													className="text-muted-foreground hover:text-accent-foreground block duration-150"
													prefetch={true}
												>
													{item.name}
												</Link>
											)}
										</li>
									))}

									<li className="space-y-2">
										<div className="text-muted-foreground text-sm font-medium">
											Resources
										</div>
										<ul className="space-y-3 pl-4">
											{resourcesItems.map((item, index) => (
												<li key={index}>
													<Link
														href={item.href}
														className="text-muted-foreground hover:text-accent-foreground block duration-150"
														prefetch={true}
													>
														{item.name}
													</Link>
												</li>
											))}
										</ul>
									</li>

									{/* Mobile Social Icons */}
									<li className="flex items-center gap-4 pt-4 border-t border-border">
										<a
											href={config.githubUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-muted-foreground hover:text-accent-foreground p-2 rounded-md transition-colors"
											aria-label="GitHub"
										>
											<Github className="h-5 w-5" />
										</a>
										<a
											href={config.discordUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-muted-foreground hover:text-accent-foreground p-2 rounded-md transition-colors"
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
									</li>
								</ul>
							</div>

							<div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit items-center">
								{children}
								<div className="flex items-center gap-2 lg:order-first lg:mr-4">
									<a
										href={config.githubUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-accent-foreground p-2 rounded-md transition-colors hidden lg:block"
										aria-label="GitHub"
									>
										<Github className="h-5 w-5" />
									</a>
									<a
										href={config.discordUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-accent-foreground p-2 rounded-md transition-colors hidden lg:block"
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

								<Button
									asChild
									className={cn(
										"bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-200 font-medium w-full md:w-fit",
									)}
								>
									<AuthLink href="/signup">Get Started</AuthLink>
								</Button>
								<ThemeToggle />
							</div>
						</div>
					</div>
				</div>
			</nav>
		</header>
	);
};
