"use client";

import Link from "next/link";

import { ModeToggle } from "@/components/mode-toggle";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { SidebarTrigger } from "@/lib/components/sidebar";
import Logo from "@/lib/icons/Logo";

export function MobileHeader() {
	const { buildUrl } = useDashboardNavigation();

	return (
		<header className="bg-background fixed top-0 left-0 right-0 z-50 flex h-14 items-center gap-4 border-b px-4 sm:static md:hidden">
			<SidebarTrigger />
			<Link
				href={buildUrl()}
				className="flex items-center gap-2 font-semibold"
				prefetch={true}
			>
				<Logo className="h-6 w-6 rounded-full text-black dark:text-white" />
				<span>LLM Gateway</span>
			</Link>
			<div className="flex flex-1 items-center justify-end gap-2">
				<ModeToggle />
			</div>
		</header>
	);
}
