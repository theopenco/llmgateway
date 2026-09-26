"use client";

import { ChevronsUpDown } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { useAppConfig } from "@/lib/config";
import { withOrgParam } from "@/lib/utils";

import { LoungeLogo } from "@llmgateway/shared/product-logos";
import {
	ProductIdentity,
	ProductSwitcher as SharedProductSwitcher,
} from "@llmgateway/shared/product-switcher";

export function ProductSwitcher() {
	const config = useAppConfig();
	const searchParams = useSearchParams();
	const { isMobile, state } = useSidebar();
	return (
		<SharedProductSwitcher
			current="lounge"
			urls={{
				gateway: `${config.uiUrl}/dashboard`,
				devpass: `${config.devpassUrl}/dashboard`,
				airside: `${config.airsideUrl}/dashboard`,
				lounge: withOrgParam("/", searchParams.get("orgId")),
			}}
			side={isMobile || state === "expanded" ? "bottom" : "right"}
		>
			<SidebarMenuButton
				size="lg"
				tooltip="Switch product"
				className="data-[state=open]:bg-sidebar-accent"
			>
				<span className="hidden size-8 shrink-0 items-center justify-center group-data-[collapsible=icon]:flex">
					<LoungeLogo className="size-6" />
				</span>
				<ProductIdentity
					product="lounge"
					className="group-data-[collapsible=icon]:hidden"
				/>
				<ChevronsUpDown
					className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
					aria-hidden="true"
				/>
			</SidebarMenuButton>
		</SharedProductSwitcher>
	);
}
