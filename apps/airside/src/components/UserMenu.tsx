"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpRight,
	BookOpen,
	ChevronsUpDown,
	LogOut,
	Monitor,
	Moon,
	Settings,
	Sun,
	SunMoon,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

interface MenuUser {
	name: string | null;
	email: string;
}

function getInitials(user: MenuUser): string {
	const source = user.name?.trim() || user.email.split("@")[0];
	const parts = source.split(/[\s._-]+/).filter(Boolean);
	const initials =
		parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
	return initials.toUpperCase();
}

function UserAvatar({
	user,
	className,
}: {
	user: MenuUser;
	className?: string;
}) {
	return (
		<Avatar className={cn("size-8 rounded-md", className)}>
			<AvatarFallback className="bg-primary/15 text-primary rounded-md font-mono text-xs font-semibold">
				{getInitials(user)}
			</AvatarFallback>
		</Avatar>
	);
}

function UserMenuContent({
	user,
	side,
	align,
	onNavigate,
}: {
	user: MenuUser;
	side: "top" | "right" | "bottom";
	align: "start" | "end";
	onNavigate?: () => void;
}) {
	const config = useAppConfig();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { signOut } = useAuth();
	const { theme, setTheme } = useTheme();

	async function handleSignOut() {
		await signOut();
		queryClient.clear();
		router.push("/login");
	}

	return (
		<DropdownMenuContent
			side={side}
			align={align}
			sideOffset={6}
			collisionPadding={12}
			className="w-64 rounded-lg"
		>
			<DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
				<UserAvatar user={user} />
				<div className="grid min-w-0 flex-1 leading-tight">
					<span className="truncate text-sm font-medium">
						{user.name || "Signed in"}
					</span>
					<span className="text-muted-foreground truncate text-xs">
						{user.email}
					</span>
				</div>
			</DropdownMenuLabel>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="gap-2">
						<SunMoon className="text-muted-foreground size-4" />
						Theme
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="min-w-36">
						<DropdownMenuRadioGroup
							value={theme ?? "system"}
							onValueChange={setTheme}
						>
							<DropdownMenuRadioItem value="light" className="gap-2">
								<Sun className="size-4" />
								Light
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="dark" className="gap-2">
								<Moon className="size-4" />
								Dark
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="system" className="gap-2">
								<Monitor className="size-4" />
								System
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuItem asChild className="gap-2">
					<Link href="/dashboard/settings" onClick={onNavigate}>
						<Settings className="text-muted-foreground size-4" />
						Company settings
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2">
					<Link href="/dashboard/crew" onClick={onNavigate}>
						<Users className="text-muted-foreground size-4" />
						Crew
					</Link>
				</DropdownMenuItem>
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				<DropdownMenuItem asChild className="gap-2">
					<a href={config.docsUrl} target="_blank" rel="noopener noreferrer">
						<BookOpen className="text-muted-foreground size-4" />
						Docs
						<ArrowUpRight className="text-muted-foreground ml-auto size-3.5" />
					</a>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="gap-2">
					<a href={config.uiUrl}>
						<ArrowUpRight className="text-muted-foreground size-4" />
						Back to LLM Gateway
					</a>
				</DropdownMenuItem>
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem className="gap-2" onSelect={() => void handleSignOut()}>
				<LogOut className="text-muted-foreground size-4" />
				Sign out
			</DropdownMenuItem>
		</DropdownMenuContent>
	);
}

function SidebarUserMenu({ user }: { user: MenuUser }) {
	const { isMobile, state, setOpenMobile } = useSidebar();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton
					size="lg"
					aria-label="Account menu"
					className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
				>
					<UserAvatar user={user} />
					<div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
						<span className="truncate text-sm font-medium">
							{user.name || user.email}
						</span>
						<span className="text-muted-foreground truncate text-xs">
							{user.email}
						</span>
					</div>
					<ChevronsUpDown className="text-muted-foreground ml-auto size-4 group-data-[collapsible=icon]:hidden" />
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<UserMenuContent
				user={user}
				side={isMobile ? "top" : state === "collapsed" ? "right" : "top"}
				align="end"
				onNavigate={() => {
					if (isMobile) {
						setOpenMobile(false);
					}
				}}
			/>
		</DropdownMenu>
	);
}

export function UserMenu({
	variant = "sidebar",
}: {
	variant?: "sidebar" | "compact";
}) {
	const { user } = useUser();

	if (!user) {
		return null;
	}

	if (variant === "sidebar") {
		return <SidebarUserMenu user={user} />;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label="Account menu"
					className="focus-visible:ring-ring rounded-md outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 data-[state=open]:opacity-85"
				>
					<UserAvatar user={user} />
				</button>
			</DropdownMenuTrigger>
			<UserMenuContent user={user} side="bottom" align="end" />
		</DropdownMenu>
	);
}
