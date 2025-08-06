"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { GitHubStars } from "./github-stars";
import { ThemeToggle } from "./theme-toggle";
import { AuthLink } from "../shared/auth-link";
import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";
import Logo from "@/lib/icons/Logo";
import { cn } from "@/lib/utils";

export const Navbar = () => {
	const config = useAppConfig();

	const menuItems = [
		{ name: "Pricing", href: "/#pricing", external: false },
		{ name: "Docs", href: config.docsUrl ?? "", external: true },
		{ name: "Models", href: "/models", external: false },
		{ name: "Playground", href: "/playground", external: false },
		{ name: "Changelog", href: "/changelog", external: false },
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
							<ul className="flex gap-8 text-sm">
								{menuItems.map((item, index) => (
									<li key={index}>
										{item.external ? (
											<a
												href={item.href}
												target="_blank"
												rel="noopener noreferrer"
												className="text-muted-foreground hover:text-accent-foreground block duration-150 px-4 py-2"
											>
												{item.name}
											</a>
										) : (
											<Link
												href={item.href}
												className="text-muted-foreground hover:text-accent-foreground block duration-150 px-4 py-2"
												prefetch={true}
											>
												{item.name}
											</Link>
										)}
									</li>
								))}
							</ul>
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
								</ul>
							</div>

							<div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit items-center">
								<GitHubStars />
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
