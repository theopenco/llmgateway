"use client";

import { usePathname } from "next/navigation";

import { useCompany } from "@/components/dashboard/company-context";
import { QueryError } from "@/components/dashboard/IncidentsTable";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";
import { ProductSwitcher } from "@/components/ProductSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { useAppConfig } from "@/lib/config";

import type { ReactNode } from "react";

function TopBarTitle() {
	const pathname = usePathname();
	const config = useAppConfig();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { signOut } = useAuth();
	const { companies, company, setCompanyId, isError, isFetching, retry } =
		useCompany();

	async function handleSignOut() {
		await signOut();
		queryClient.clear();
		router.push("/login");
	}

	return (
		<nav aria-label="Breadcrumb" className="min-w-0 flex-1">
			<ol className="flex min-w-0 items-center gap-2">
				<li className="text-muted-foreground hidden shrink-0 font-mono text-[0.7rem] tracking-wider uppercase sm:block">
					{active?.group.label ?? "Console"}
				</li>
				{active ? (
					<>
						<li
							aria-hidden="true"
							className="text-muted-foreground/60 hidden font-mono text-xs sm:block"
						>
							/
						</li>
						<li
							aria-current="page"
							className="font-display truncate text-sm font-bold tracking-tight"
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
				{isError ? (
					<QueryError
						message="Could not load your carrier companies."
						onRetry={retry}
						retrying={isFetching}
					/>
				) : (
					children
				)}
			</main>
		</div>
	);
}
