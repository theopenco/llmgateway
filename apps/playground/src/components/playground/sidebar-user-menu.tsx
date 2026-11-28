"use client";

import { ChevronUp, CreditCard, ExternalLink, LogOut } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useLogout } from "@/hooks/useLogout";

import type { ReactNode } from "react";

const DASHBOARD_URL =
	process.env.NODE_ENV === "development"
		? "http://localhost:3002/dashboard"
		: "https://llmgateway.io/dashboard";

interface SidebarUserMenuProps {
	user: { name?: string | null; email?: string | null } | null | undefined;
	leadingItems?: ReactNode;
}

function getInitials(name: string | null | undefined): string {
	return (
		name
			?.split(" ")
			.map((part) => part[0])
			.join("")
			.toUpperCase()
			.slice(0, 2) ?? "U"
	);
}

export function SidebarUserMenu({ user, leadingItems }: SidebarUserMenuProps) {
	const logout = useLogout();

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							tooltip={user?.name ?? "User"}
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<span className="text-xs font-semibold">
									{getInitials(user?.name)}
								</span>
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">{user?.name}</span>
								<span className="truncate text-xs text-muted-foreground">
									{user?.email}
								</span>
							</div>
							<ChevronUp className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
						side="top"
						align="end"
						sideOffset={4}
					>
						{leadingItems}
						<DropdownMenuItem asChild>
							<Link href="/pricing" prefetch={true}>
								<CreditCard className="mr-2 h-4 w-4" />
								Membership &amp; Billing
							</Link>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem asChild>
							<a href={DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
								<ExternalLink className="mr-2 h-4 w-4" />
								Dashboard
							</a>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="justify-between gap-3"
							onSelect={(event) => event.preventDefault()}
						>
							<span>Theme</span>
							<div
								onClick={(event) => event.stopPropagation()}
								onKeyDown={(event) => event.stopPropagation()}
							>
								<ThemeToggle className="shrink-0" size="compact" />
							</div>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={logout}>
							<LogOut className="mr-2 h-4 w-4" />
							Log out
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
