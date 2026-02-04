"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, LayoutDashboard, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-client";

import { Logo } from "./ui/logo";

import type { ReactNode } from "react";

interface AdminShellProps {
	children: ReactNode;
}

function MobileHeader() {
	const { toggleSidebar } = useSidebar();

	return (
		<header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-border/60 bg-background px-4 md:hidden">
			<Button
				variant="ghost"
				size="icon"
				className="h-9 w-9"
				onClick={toggleSidebar}
			>
				<Menu className="h-5 w-5" />
				<span className="sr-only">Toggle menu</span>
			</Button>
			<div className="flex items-center gap-2">
				<div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Logo className="h-4 w-4" />
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-semibold leading-tight">
						LLM Gateway
					</span>
					<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						Admin
					</span>
				</div>
			</div>
		</header>
	);
}

export function AdminShell({ children }: AdminShellProps) {
	const pathname = usePathname();
	const router = useRouter();
	const { signOut } = useAuth();
	const queryClient = useQueryClient();

	const isDashboard = pathname === "/" || pathname === "";
	const isOrganizations = pathname.startsWith("/organizations");

	const handleSignOut = async () => {
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					router.push("/login");
				},
			},
		});
	};

	return (
		<SidebarProvider>
			<Sidebar variant="inset">
				<SidebarHeader className="border-b border-sidebar-border/60">
					<div className="flex h-12 items-center justify-between px-2">
						<div className="flex items-center gap-2 px-1">
							<div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
								<Logo className="h-4 w-4" />
							</div>
							<div className="flex flex-col">
								<span className="text-sm font-semibold leading-tight">
									LLM Gateway
								</span>
								<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									Admin
								</span>
							</div>
						</div>
						<SidebarTrigger className="hidden md:flex" />
					</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>Main</SidebarGroupLabel>
						<SidebarMenu>
							<SidebarMenuItem>
								<Link href="/" className="block">
									<SidebarMenuButton isActive={isDashboard} size="lg">
										<LayoutDashboard className="h-4 w-4" />
										<span>Dashboard</span>
									</SidebarMenuButton>
								</Link>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<Link href="/organizations" className="block">
									<SidebarMenuButton isActive={isOrganizations} size="lg">
										<Building2 className="h-4 w-4" />
										<span>Organizations</span>
									</SidebarMenuButton>
								</Link>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter className="border-t border-sidebar-border/60">
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start gap-2 text-xs text-muted-foreground"
						onClick={handleSignOut}
					>
						<LogOut className="h-3.5 w-3.5" />
						<span>Sign out</span>
					</Button>
				</SidebarFooter>
			</Sidebar>
			<SidebarInset>
				<MobileHeader />
				{children}
			</SidebarInset>
		</SidebarProvider>
	);
}
