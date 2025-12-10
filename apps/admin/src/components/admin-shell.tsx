"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, LogOut, Users } from "lucide-react";
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
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-client";

import { Logo } from "./ui/logo";

import type { ReactNode } from "react";

interface AdminShellProps {
	children: ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
	const pathname = usePathname();
	const router = useRouter();
	const { signOut } = useAuth();
	const queryClient = useQueryClient();

	const isDashboard = pathname === "/" || pathname === "";

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
						<SidebarTrigger />
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
						</SidebarMenu>
					</SidebarGroup>
					<SidebarGroup>
						<SidebarGroupLabel>People</SidebarGroupLabel>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton size="lg" asChild>
									<div className="flex w-full items-center gap-2 text-sidebar-foreground/80 hover:text-sidebar-accent-foreground">
										<Users className="h-4 w-4" />
										<span>Users (coming soon)</span>
									</div>
								</SidebarMenuButton>
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
			<SidebarInset>{children}</SidebarInset>
		</SidebarProvider>
	);
}
