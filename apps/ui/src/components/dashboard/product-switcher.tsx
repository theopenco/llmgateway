"use client";

import {
	Check,
	ChevronsUpDown,
	MessagesSquare,
	Plane,
	Terminal,
} from "lucide-react";
import Link from "next/link";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/lib/components/sidebar";
import { useAppConfig } from "@/lib/config";
import Logo, { LogoLockup } from "@/lib/icons/Logo";

export function ProductSwitcher() {
	const { buildUrl } = useDashboardNavigation();
	const { isMobile, state } = useSidebar();
	const { devpassUrl, airsideUrl, playgroundUrl } = useAppConfig();
	const products = [
		{
			name: "LLM Gateway",
			description: "API routing and usage",
			href: buildUrl(),
			icon: Logo,
			current: true,
		},
		{
			name: "DevPass",
			description: "Plans for coding agents",
			href: `${devpassUrl}/dashboard`,
			icon: Terminal,
			current: false,
		},
		{
			name: "Airside",
			description: "Serve models as a carrier",
			href: `${airsideUrl}/dashboard`,
			icon: Plane,
			current: false,
		},
		{
			name: "Lounge",
			description: "Chat and create with AI",
			href: playgroundUrl,
			icon: MessagesSquare,
			current: false,
		},
	];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton
					size="lg"
					tooltip="Switch product"
					aria-label="Switch product, current product LLM Gateway"
					className="data-[state=open]:bg-sidebar-accent"
				>
					<div className="hidden aspect-square size-8 items-center justify-center group-data-[collapsible=icon]:flex">
						<Logo className="size-6" />
					</div>
					<span className="group-data-[collapsible=icon]:hidden">
						<LogoLockup className="h-6 w-auto" />
					</span>
					<ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side={isMobile || state === "expanded" ? "bottom" : "right"}
				align="start"
				sideOffset={6}
				className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-2"
			>
				<DropdownMenuLabel className="px-2 pb-2 text-xs font-medium text-muted-foreground">
					Switch product
				</DropdownMenuLabel>
				{products.map((product) => (
					<DropdownMenuItem
						key={product.name}
						asChild
						className="rounded-lg p-2"
					>
						<Link
							href={product.href}
							aria-current={product.current ? "page" : undefined}
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
								<product.icon className="size-5" />
							</span>
							<span className="flex-1">
								<span className="block font-medium">{product.name}</span>
								<span className="block text-xs text-muted-foreground">
									{product.description}
								</span>
							</span>
							{product.current && (
								<Check
									className="size-4 text-muted-foreground"
									aria-hidden="true"
								/>
							)}
						</Link>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
