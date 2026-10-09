"use client";

import { usePathname } from "next/navigation";

import { AirsideSidebar } from "@/components/dashboard/AirsideSidebar";
import { useCompany } from "@/components/dashboard/company-context";
import { QueryError } from "@/components/dashboard/IncidentsTable";
import { findActiveNav, getNavGroups } from "@/components/dashboard/nav";
import { ShellBanners } from "@/components/dashboard/ShellBanners";
import { TopBarActions } from "@/components/dashboard/TopBarActions";
import { useNavBadges } from "@/components/dashboard/useNavBadges";
import { Separator } from "@/components/ui/separator";
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
	const active = findActiveNav(getNavGroups(config.uiUrl), pathname);

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
							{active.item.label}
						</li>
					</>
				) : null}
			</ol>
		</nav>
	);
}

export function DashboardShell({
	children,
	defaultSidebarOpen = true,
}: {
	children: ReactNode;
	defaultSidebarOpen?: boolean;
}) {
	const badges = useNavBadges();
	const { isError, isFetching, retry } = useCompany();

	return (
		<SidebarProvider defaultOpen={defaultSidebarOpen}>
			<AirsideSidebar badges={badges} />
			<SidebarInset className="min-w-0">
				<header className="bg-background/90 supports-backdrop-filter:bg-background/75 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur sm:px-6 md:rounded-t-xl">
					<SidebarTrigger className="-ml-1" />
					<Separator orientation="vertical" className="mr-1 h-4!" />
					<TopBarTitle />
					<TopBarActions />
				</header>
				<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
					<ShellBanners />
					<div className="min-w-0 flex-1">
						{isError ? (
							<QueryError
								message="Could not load your carrier companies."
								onRetry={retry}
								retrying={isFetching}
							/>
						) : (
							children
						)}
					</div>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
