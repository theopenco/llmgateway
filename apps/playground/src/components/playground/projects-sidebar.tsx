"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	AudioLines,
	ChevronUp,
	ExternalLink,
	Film,
	FolderIcon,
	ImagePlus,
	LogOut,
	MessageSquare,
	PenTool,
	Plus,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/ui/logo";
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
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

import { ChatSidebarSkeleton } from "./chat-sidebar-skeleton";
import {
	SidebarChatSearch,
	SidebarShortcutKbd,
	useSidebarShortcut,
} from "./sidebar-actions";

import type { ChatProject } from "@/hooks/useChatProjects";
import type { Organization } from "@/lib/types";

interface ProjectsSidebarProps {
	projects: ChatProject[];
	selectedProjectId: string | null;
	onSelectProject: (projectId: string) => void;
	isLoading?: boolean;
	onCreateOpen: () => void;
	selectedOrganization: Organization | null;
	className?: string;
}

export function ProjectsSidebar({
	projects,
	selectedProjectId,
	onSelectProject,
	isLoading,
	onCreateOpen,
	selectedOrganization,
	className,
}: ProjectsSidebarProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { state: sidebarState, isMobile } = useSidebar();
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();

	const isMac = useSidebarShortcut("j", onCreateOpen);

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
							: "https://chat.llmgateway.io/login",
					);
				},
			},
		});
	};

	const isHistoryHidden = sidebarState === "collapsed" && !isMobile;

	if (isUserLoading) {
		return <ChatSidebarSkeleton organization={null} isOrgLoading={false} />;
	}

	if (!user) {
		return (
			<Sidebar className={className}>
				<SidebarHeader>
					<div className="flex flex-col items-center gap-4 mb-4">
						<Link
							href="/"
							className="flex self-start items-center gap-2 my-2"
							prefetch={true}
						>
							<Logo className="size-6" />
							<h1 className="text-xl font-semibold">LLM Gateway</h1>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to view your projects.
							</p>
							<div className="flex items-center justify-end gap-2">
								<Button size="sm" asChild>
									<Link href="/login">Sign in</Link>
								</Button>
							</div>
						</div>
					</div>
				</SidebarHeader>
			</Sidebar>
		);
	}

	return (
		<Sidebar collapsible="icon" className={cn(className, "max-md:hidden")}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild tooltip="LLM Gateway">
							<Link href="/" prefetch={true}>
								<div className="flex aspect-square size-8 items-center justify-center">
									<Logo className="size-6" />
								</div>
								<span className="text-lg font-bold tracking-tight">
									LLM Gateway
								</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarChatSearch disabled />
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="New Project"
							className="border border-border"
							onClick={onCreateOpen}
						>
							<Plus className="h-4 w-4" />
							<span>New Project</span>
							<SidebarShortcutKbd keys={isMac ? "⌘J" : "Alt+J"} />
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Chat">
							<Link href="/" prefetch={true}>
								<MessageSquare className="h-4 w-4" />
								<span>Chat</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Group Chat">
							<Link href="/group" prefetch={true}>
								<Users className="h-4 w-4" />
								<span>Group Chat</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Image Studio">
							<Link href="/image" prefetch={true}>
								<ImagePlus className="h-4 w-4" />
								<span>Image Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Video Studio">
							<Link href="/video" prefetch={true}>
								<Film className="h-4 w-4" />
								<span>Video Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Audio Studio">
							<Link href="/audio" prefetch={true}>
								<AudioLines className="h-4 w-4" />
								<span>Audio Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton asChild tooltip="Canvas">
							<Link href="/canvas" prefetch={true}>
								<PenTool className="h-4 w-4" />
								<span>Canvas</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent className="overflow-hidden pb-2">
				<div>
					<div className="mx-2 mb-2 border-t border-sidebar-border" />
				</div>
				<div
					aria-hidden={isHistoryHidden}
					className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
				>
					<div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
						My Projects
					</div>
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<span className="text-muted-foreground text-sm">
								Loading projects...
							</span>
						</div>
					) : projects.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
							<FolderIcon className="h-8 w-8 text-muted-foreground/50 mb-3" />
							<p className="text-sm text-muted-foreground">No projects yet</p>
						</div>
					) : (
						<SidebarMenu className="px-2">
							{projects.map((project) => (
								<SidebarMenuItem key={project.id}>
									<SidebarMenuButton
										isActive={selectedProjectId === project.id}
										onClick={() => onSelectProject(project.id)}
										tooltip={project.name}
										className="h-auto py-2"
									>
										<div className="flex-1 min-w-0">
											<div className="truncate text-sm font-medium">
												{project.name}
											</div>
											<div className="truncate text-xs text-muted-foreground">
												{project.fileCount}{" "}
												{project.fileCount === 1 ? "file" : "files"} ·{" "}
												{project.chatCount}{" "}
												{project.chatCount === 1 ? "chat" : "chats"}
											</div>
										</div>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					)}
				</div>
			</SidebarContent>

			<SidebarFooter>
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={selectedOrganization}
						isLoading={false}
					/>
				</div>
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<SidebarMenuButton
									size="lg"
									tooltip={user.name ?? "User"}
									className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
								>
									<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
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
										<span className="truncate font-semibold">{user.name}</span>
										<span className="truncate text-xs text-muted-foreground">
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
			</SidebarFooter>
		</Sidebar>
	);
}
