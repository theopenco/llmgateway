"use client";

import Link from "next/link";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { useAppConfig } from "@/lib/config";

export function Header() {
	const { user } = useUser();
	const config = useAppConfig();

	return (
		<header className="border-border/60 bg-background sticky top-0 z-40 border-b">
			<div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 py-3 sm:px-6 xl:h-16 xl:flex-nowrap xl:py-0">
				<div className="flex items-center gap-3">
					<Link
						href="/"
						aria-label="Airside home"
						className="flex items-center gap-2.5"
					>
						<Logo />
						<span className="font-display hidden text-lg font-black tracking-tight sm:inline">
							AIRSIDE
						</span>
					</Link>
					<a
						href={config.uiUrl}
						className="text-muted-foreground hover:text-foreground hidden text-xs sm:block"
					>
						by LLM Gateway
					</a>
				</div>

				<nav
					aria-label="Main navigation"
					className="text-muted-foreground order-last flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-3 text-sm xl:order-none xl:w-auto xl:pt-0"
				>
					<Link href="/#how-it-works" className="hover:text-foreground">
						How it works
					</Link>
					<Link href="/#dispatch" className="hover:text-foreground">
						Dispatch
					</Link>
					<Link href="/#faq" className="hover:text-foreground">
						FAQ
					</Link>
					<Link href="/resources" className="hover:text-foreground">
						Guides & tools
					</Link>
					<a
						href={`${config.uiUrl}/rankings`}
						className="hover:text-foreground"
					>
						Model rankings
					</a>
				</nav>

				<div className="flex items-center gap-2">
					<ThemeToggle />
					{user ? (
						<Button asChild size="sm">
							<Link href="/dashboard">Operations</Link>
						</Button>
					) : (
						<>
							<Button asChild variant="ghost" size="sm">
								<Link href="/login">Sign in</Link>
							</Button>
							<Button asChild size="sm">
								<Link href="/signup">
									<span className="sm:hidden">List API</span>
									<span className="hidden sm:inline">
										Claim your carrier code
									</span>
								</Link>
							</Button>
						</>
					)}
				</div>
			</div>
		</header>
	);
}
