"use client";

import { ProductSwitcher } from "@/components/dashboard/product-switcher";
import { ModeToggle } from "@/components/mode-toggle";
import { SidebarTrigger } from "@/lib/components/sidebar";

export function MobileHeader() {
	return (
		<header className="bg-background fixed top-0 left-0 right-0 z-50 flex h-14 items-center gap-4 border-b px-4 sm:static md:hidden">
			<SidebarTrigger />
			<ProductSwitcher compact />
			<div className="flex flex-1 items-center justify-end gap-2">
				<ModeToggle />
			</div>
		</header>
	);
}
