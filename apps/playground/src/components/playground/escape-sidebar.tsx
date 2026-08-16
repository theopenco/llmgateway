"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronUp, CreditCard, ExternalLink, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { SidebarLoungePoints } from "@/components/lounge/sidebar-points";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Wordmark } from "@/components/ui/wordmark";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

import { ESCAPE_LEVELS } from "@llmgateway/shared/sandbox-escape";

import { StudioNav } from "./studio-nav";

import type { Organization } from "@/lib/types";

interface EscapeSidebarProps {
	selectedOrganization: Organization | null;
	levelId: number;
	onSelectLevel: (levelId: number) => void;
	className?: string;
}

export function EscapeSidebar({
	selectedOrganization,
	levelId,
	onSelectLevel,
	className,
}: EscapeSidebarProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { state: sidebarState, isMobile } = useSidebar();
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();

	const logout = async () => {
		try {
			await clearLastUsedProjectCookiesAction();
		} catch {
			// ignore
		}
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					queryClient.clear();
					router.push(
						process.env.NODE_ENV === "development"
							? "http://localhost:3003/login"
							: "https://lounge.llmgateway.io/login",
					);
				},
			},
		});
	};

	const levelsHidden = sidebarState === "collapsed" && !isMobile;

	if (!isUserLoading && !user) {
		return (
			<Sidebar className={className}>
				<SidebarHeader>
					<div className="mb-4 flex flex-col items-center gap-4">
						<Link
							href="/"
							className="my-2 flex items-center gap-2 self-start"
							prefetch={true}
						>
							<Wordmark />
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="mb-2 font-medium">Sign in to play</div>
							<p className="text-muted-foreground mb-3">
								The model spends your credits as it plays, so a signed-in
								account is required.
							</p>
							<div className="flex items-center justify-end gap-2">
								<Button size="sm" asChild>
									<Link href="/login">Sign in</Link>
								</Button>
							</div>
						</div>
					</div>
					<StudioNav />
				</SidebarHeader>
			</Sidebar>
		);
	}

	return (
		<Sidebar collapsible="icon" className={cn(className, "max-md:hidden")}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild tooltip="Lounge">
							<Link href="/" prefetch={true}>
								<Wordmark size="sm" iconBox />
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<StudioNav />
			</SidebarHeader>

			<SidebarContent className="overflow-hidden pb-2">
				<div className="mx-2 mb-2 border-t border-sidebar-border" />
				<div
					aria-hidden={levelsHidden}
					inert={levelsHidden}
					className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
				>
					<div className="text-muted-foreground px-4 py-2 text-xs font-medium tracking-wider uppercase">
						Levels
					</div>
					<SidebarMenu className="px-2">
						{ESCAPE_LEVELS.map((level) => (
							<SidebarMenuItem key={level.id}>
								<SidebarMenuButton
									isActive={level.id === levelId}
									onClick={() => onSelectLevel(level.id)}
									tooltip={level.name}
									className="h-auto py-2"
								>
									<span className="text-muted-foreground font-mono text-xs">
										{String(level.id).padStart(2, "0")}
									</span>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">
											{level.name}
										</div>
										<div className="text-muted-foreground truncate text-xs">
											{level.tagline}
										</div>
									</div>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</div>
			</SidebarContent>

			<SidebarFooter>
				<SidebarLoungePoints />
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={selectedOrganization}
						isLoading={false}
					/>
				</div>
				{user ? (
					<SidebarMenu>
						<SidebarMenuItem>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<SidebarMenuButton
										size="lg"
										tooltip={user.name ?? "User"}
										className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
									>
										<div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
											<span className="text-xs font-semibold">
												{user.name
													?.split(" ")
													.map((n: string) => n[0])
													.join("")
													.toUpperCase()
													.slice(0, 2) ?? "U"}
											</span>
										</div>
										<div className="grid flex-1 text-left text-sm leading-tight">
											<span className="truncate font-semibold">
												{user.name}
											</span>
											<span className="text-muted-foreground truncate text-xs">
												{user.email}
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
									<DropdownMenuItem asChild>
										<Link href="/pricing" prefetch={true}>
											<CreditCard className="mr-2 h-4 w-4" />
											Membership &amp; Billing
										</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem asChild>
										<a
											href={
												process.env.NODE_ENV === "development"
													? "http://localhost:3002/dashboard"
													: "https://llmgateway.io/dashboard"
											}
											target="_blank"
											rel="noopener noreferrer"
										>
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
				) : null}
			</SidebarFooter>
		</Sidebar>
	);
}
