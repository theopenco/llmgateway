"use client";

import { Code, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { useAppConfig } from "@/lib/config";

export function Header() {
	const config = useAppConfig();
	const { user, isLoading } = useUser();
	const isAuthenticated = !!user && !isLoading;
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<header className="border-b border-border/50">
			<div className="container mx-auto px-4 py-4 flex items-center justify-between">
				<Link href="/" className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
						<Code className="h-4 w-4" />
					</div>
					<span className="font-semibold text-lg">DevPass</span>
					<span className="hidden sm:inline text-xs text-muted-foreground">
						by LLM Gateway
					</span>
				</Link>

				{/* Desktop nav */}
				<div className="hidden sm:flex items-center gap-3">
					<Button variant="ghost" size="sm" asChild>
						<Link href="/coding-models">Models</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/guides">Guides</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/pricing">Pricing</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/compare">Compare</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/leaderboard">Leaderboard</Link>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<a href={config.docsUrl} target="_blank" rel="noopener noreferrer">
							Docs
						</a>
					</Button>
					{isAuthenticated ? (
						<Button size="sm" asChild>
							<Link href="/dashboard">Dashboard</Link>
						</Button>
					) : (
						<>
							<Button variant="ghost" size="sm" asChild>
								<Link href="/login">Sign in</Link>
							</Button>
							<Button size="sm" asChild>
								<Link href="/signup">Get Started</Link>
							</Button>
						</>
					)}
				</div>

				{/* Mobile menu button */}
				<button
					type="button"
					onClick={() => setMenuOpen(!menuOpen)}
					className="sm:hidden p-2 -mr-2"
					aria-label={menuOpen ? "Close menu" : "Open menu"}
				>
					{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
				</button>
			</div>

			{/* Mobile nav */}
			{menuOpen && (
				<div className="sm:hidden border-t border-border/50 px-4 py-4 space-y-3">
					<Link
						href="/coding-models"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Models
					</Link>
					<Link
						href="/guides"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Guides
					</Link>
					<Link
						href="/pricing"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Pricing
					</Link>
					<Link
						href="/compare"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Compare
					</Link>
					<Link
						href="/leaderboard"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Leaderboard
					</Link>
					<a
						href={config.docsUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						Docs
					</a>
					{isAuthenticated ? (
						<Button size="sm" className="w-full" asChild>
							<Link href="/dashboard" onClick={() => setMenuOpen(false)}>
								Dashboard
							</Link>
						</Button>
					) : (
						<>
							<Link
								href="/login"
								className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
								onClick={() => setMenuOpen(false)}
							>
								Sign in
							</Link>
							<Button size="sm" className="w-full" asChild>
								<Link href="/signup" onClick={() => setMenuOpen(false)}>
									Get Started
								</Link>
							</Button>
						</>
					)}
				</div>
			)}
		</header>
	);
}
