"use client";

import { ArrowUpRight, Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { UserMenu } from "@/components/UserMenu";
import { useUser } from "@/hooks/useUser";
import { useAppConfig } from "@/lib/config";

interface HeaderLink {
	href: string;
	label: string;
	external?: boolean;
}

function useHeaderLinks(): HeaderLink[] {
	const config = useAppConfig();
	return [
		{ href: "/#how-it-works", label: "How it works" },
		{ href: "/#dispatch", label: "Dispatch" },
		{ href: "/#faq", label: "FAQ" },
		{ href: "/resources", label: "Guides & tools" },
		{
			href: `${config.uiUrl}/rankings`,
			label: "Model rankings",
			external: true,
		},
	];
}

function HeaderNavLink({
	link,
	className,
	onNavigate,
}: {
	link: HeaderLink;
	className: string;
	onNavigate?: () => void;
}) {
	if (link.external) {
		return (
			<a href={link.href} className={className} onClick={onNavigate}>
				{link.label}
			</a>
		);
	}
	return (
		<Link href={link.href} className={className} onClick={onNavigate}>
			{link.label}
		</Link>
	);
}

function MobileMenu({
	links,
	signedIn,
}: {
	links: HeaderLink[];
	signedIn: boolean;
}) {
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Open menu"
					className="lg:hidden"
				>
					<Menu className="size-5" />
				</Button>
			</SheetTrigger>
			<SheetContent side="right" className="w-72 gap-0 p-0">
				<SheetHeader className="border-b px-5 py-4">
					<SheetTitle className="flex items-center gap-2.5">
						<Logo className="size-6" />
						<span className="font-display text-base font-black tracking-tight">
							AIRSIDE
						</span>
					</SheetTitle>
					<SheetDescription className="sr-only">
						Site navigation
					</SheetDescription>
				</SheetHeader>
				<nav
					aria-label="Mobile navigation"
					className="flex flex-col gap-1 px-3 py-4"
				>
					{links.map((link) => (
						<HeaderNavLink
							key={link.href}
							link={link}
							onNavigate={close}
							className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
						/>
					))}
				</nav>
				<div className="mt-auto flex flex-col gap-3 border-t px-5 py-5">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground font-mono text-[0.7rem] tracking-wider uppercase">
							Theme
						</span>
						<ThemeToggle size="compact" />
					</div>
					{signedIn ? (
						<Button asChild>
							<Link href="/dashboard" onClick={close}>
								Open console
							</Link>
						</Button>
					) : (
						<>
							<Button asChild>
								<Link href="/signup" onClick={close}>
									Claim your carrier code
								</Link>
							</Button>
							<Button asChild variant="outline">
								<Link href="/login" onClick={close}>
									Sign in
								</Link>
							</Button>
						</>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

export function Header() {
	const { user } = useUser();
	const config = useAppConfig();
	const links = useHeaderLinks();

	return (
		<header className="border-border/60 bg-background/85 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 border-b backdrop-blur">
			<div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
				<div className="flex min-w-0 items-center gap-3">
					<Link
						href="/"
						aria-label="Airside home"
						className="flex shrink-0 items-center gap-2.5"
					>
						<Logo />
						<span className="font-display hidden text-lg font-black tracking-tight sm:inline">
							AIRSIDE
						</span>
					</Link>
					<a
						href={config.uiUrl}
						className="text-muted-foreground hover:text-foreground hidden items-center gap-0.5 whitespace-nowrap font-mono text-[0.7rem] tracking-wider uppercase transition-colors md:inline-flex"
					>
						by LLM Gateway
						<ArrowUpRight className="size-3" />
					</a>
				</div>

				<nav
					aria-label="Main navigation"
					className="hidden flex-1 items-center justify-center gap-1 lg:flex"
				>
					{links.map((link) => (
						<HeaderNavLink
							key={link.href}
							link={link}
							className="text-muted-foreground hover:text-foreground hover:bg-accent/60 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors"
						/>
					))}
				</nav>

				<div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
					<ThemeToggle size="compact" className="hidden md:inline-flex" />
					{user ? (
						<>
							<Button asChild size="sm">
								<Link href="/dashboard">Open console</Link>
							</Button>
							<UserMenu variant="compact" />
						</>
					) : (
						<>
							<Button
								asChild
								variant="ghost"
								size="sm"
								className="hidden sm:inline-flex"
							>
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
					<MobileMenu links={links} signedIn={!!user} />
				</div>
			</div>
		</header>
	);
}
