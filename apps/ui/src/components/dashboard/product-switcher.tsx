"use client";

import { ChevronsUpDown } from "lucide-react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { SidebarMenuButton, useSidebar } from "@/lib/components/sidebar";
import { useAppConfig } from "@/lib/config";
import Logo, { LogoLockup } from "@/lib/icons/Logo";

import { ProductSwitcher as SharedProductSwitcher } from "@llmgateway/shared/product-switcher";

export function ProductSwitcher({ compact = false }: { compact?: boolean }) {
	const { buildUrl } = useDashboardNavigation();
	const { isMobile, state } = useSidebar();
	const { devpassUrl, airsideUrl, playgroundUrl } = useAppConfig();
	const urls = {
		gateway: buildUrl(),
		devpass: `${devpassUrl}/dashboard`,
		airside: `${airsideUrl}/dashboard`,
		lounge: playgroundUrl,
	};
	if (compact) {
		return <SharedProductSwitcher current="gateway" urls={urls} />;
	}
	return (
		<SharedProductSwitcher
			current="gateway"
			urls={urls}
			side={isMobile || state === "expanded" ? "bottom" : "right"}
		>
			<SidebarMenuButton
				size="lg"
				tooltip="Switch product"
				className="data-[state=open]:bg-sidebar-accent"
			>
				<div className="hidden aspect-square size-8 items-center justify-center group-data-[collapsible=icon]:flex">
					<Logo className="size-6" />
				</div>
				<span className="group-data-[collapsible=icon]:hidden">
					<LogoLockup className="h-6 w-auto" />
				</span>
				<ChevronsUpDown
					className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
					aria-hidden="true"
				/>
			</SidebarMenuButton>
		</SharedProductSwitcher>
	);
}
