"use client";

import Link from "next/link";

import { Logo } from "@/components/Logo";
import { useAppConfig } from "@/lib/config";

export function Footer() {
	const config = useAppConfig();

	return (
		<footer className="border-border/60 border-t">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
				<div className="flex items-center gap-2.5">
					<Logo className="size-6" />
					<span className="font-display font-black tracking-tight">
						AIRSIDE
					</span>
					<span className="text-muted-foreground text-xs">
						— the carrier console for LLM Gateway
					</span>
				</div>
				<nav className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
					<a href={config.uiUrl} className="hover:text-foreground">
						LLM Gateway
					</a>
					<a href={config.docsUrl} className="hover:text-foreground">
						Docs
					</a>
					<a href={config.githubUrl} className="hover:text-foreground">
						GitHub
					</a>
					<a href={config.discordUrl} className="hover:text-foreground">
						Discord
					</a>
					<Link href="/login" className="hover:text-foreground">
						Sign in
					</Link>
				</nav>
			</div>
		</footer>
	);
}
