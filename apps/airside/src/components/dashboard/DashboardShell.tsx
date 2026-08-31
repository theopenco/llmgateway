"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useCompany } from "@/components/dashboard/company-context";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

const NAV = [
	{ href: "/dashboard", label: "Operations", exact: true },
	{ href: "/dashboard/fleet", label: "Fleet", exact: false },
	{ href: "/dashboard/traffic", label: "Traffic", exact: false },
	{ href: "/dashboard/fares", label: "Fares", exact: false },
	{ href: "/dashboard/filings", label: "Filings", exact: false },
	{ href: "/dashboard/crew", label: "Crew", exact: false },
];

export function DashboardShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { signOut } = useAuth();
	const { companies, company, setCompanyId } = useCompany();

	async function handleSignOut() {
		await signOut();
		queryClient.clear();
		router.push("/login");
	}

	return (
		<div className="flex min-h-screen flex-col">
			<header className="border-border/60 bg-background sticky top-0 z-40 border-b">
				<div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
					<div className="flex min-w-0 items-center gap-3">
						<Link href="/" className="flex shrink-0 items-center gap-2">
							<Logo className="size-6" />
							<span className="font-display hidden font-black tracking-tight sm:inline">
								AIRSIDE
							</span>
						</Link>
						{companies.length > 0 ? (
							<Select
								value={company?.id ?? ""}
								onValueChange={(value) => setCompanyId(value)}
							>
								<SelectTrigger
									size="sm"
									className="max-w-44 font-mono text-xs"
									data-testid="company-select"
								>
									<SelectValue placeholder="Company" />
								</SelectTrigger>
								<SelectContent>
									{companies.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : null}
					</div>

					<nav className="flex items-center gap-0.5 overflow-x-auto">
						{NAV.map((item) => {
							const active = item.exact
								? pathname === item.href
								: pathname.startsWith(item.href);
							return (
								<Link
									key={item.href}
									href={item.href}
									className={cn(
										"rounded-md px-2.5 py-1.5 font-mono text-[0.7rem] tracking-wider uppercase transition-colors sm:text-xs",
										active
											? "bg-primary/15 text-primary"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{item.label}
								</Link>
							);
						})}
					</nav>

					<div className="flex shrink-0 items-center gap-1">
						<ThemeToggle />
						<Button
							variant="ghost"
							size="icon"
							aria-label="Sign out"
							onClick={handleSignOut}
						>
							<LogOut className="size-4" />
						</Button>
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
				<div className="mb-4 empty:hidden">
					<EmailVerificationBanner />
				</div>
				{children}
			</main>
		</div>
	);
}
