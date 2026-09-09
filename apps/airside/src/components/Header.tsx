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
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
				<div className="flex items-center gap-3">
					<Link href="/" className="flex items-center gap-2.5">
						<Logo />
						<span className="font-display text-lg font-black tracking-tight">
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

				<nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
					<Link href="/#how-it-works" className="hover:text-foreground">
						How it works
					</Link>
					<Link href="/#dispatch" className="hover:text-foreground">
						Dispatch
					</Link>
					<Link href="/#faq" className="hover:text-foreground">
						FAQ
					</Link>
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
								<Link href="/signup">Claim your carrier code</Link>
							</Button>
						</>
					)}
				</div>
			</div>
		</header>
	);
}
