"use client";

import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
	Plus,
	MessageSquare,
	Edit2,
	Trash2,
	MoreVerticalIcon,
	Loader2,
	ImagePlus,
	Film,
	Users,
	ChevronUp,
	LogOut,
	ExternalLink,
} from "lucide-react";
// import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { toast } from "sonner";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/ui/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
	useChats,
	useDeleteChat,
	useUpdateChat,
	type Chat,
} from "@/hooks/useChats";
import { useOrganization } from "@/hooks/useOrganization";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";

import { ChatSidebarSkeleton } from "./chat-sidebar-skeleton";
// import { ProjectSwitcher } from "./project-switcher";

import type { Organization, Project } from "@/lib/types";

// const OrganizationSwitcher = dynamic(
// 	() => import("./organization-switcher").then((m) => m.OrganizationSwitcher),
// 	{ ssr: false },
// );

interface ChatSidebarProps {
	currentChatId?: string;
	onChatSelect?: (chatId: string) => void;
	onNewChat?: () => void;
	clearMessages: () => void;
	className?: string;
	isLoading?: boolean;
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (organization: Organization | null) => void;
	onOrganizationCreated: (organization: Organization) => void;
	projects: Project[];
	selectedProject: Project | null;
	onSelectProject: (project: Project | null) => void;
	onProjectCreated: (project: Project) => void;
}

export function ChatSidebar({
	currentChatId,
	onChatSelect,
	onNewChat,
	clearMessages,
	className,
	isLoading: isPageLoading = false,
	// organizations,
	selectedOrganization,
	// onSelectOrganization,
	// onOrganizationCreated,
	// projects,
	// selectedProject,
	// onSelectProject,
	// onProjectCreated,
}: ChatSidebarProps) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const posthog = usePostHog();
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();
	const { organization, isLoading: isOrgLoading } = useOrganization();

	// Use real chat data from API
	const { data: chatsData, isLoading: isChatsLoading } = useChats();
	const deleteChat = useDeleteChat();
	const updateChat = useUpdateChat();

	const [editingId, setEditingId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");

	const chats = chatsData?.chats ?? [];

	const logout = async () => {
		posthog.reset();

		// Clear last used project cookies before signing out
		try {
			await clearLastUsedProjectCookiesAction();
		} catch {
			toast.error("Failed to clear last used project cookies");
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

	const handleEditTitle = (chat: Chat) => {
		setEditingId(chat.id);
		setEditTitle(chat.title);
	};

	const saveTitle = (chatId: string) => {
		if (editTitle.trim()) {
			updateChat.mutate({
				params: {
					path: { id: chatId },
				},
				body: { title: editTitle.trim() },
			});
		}
		setEditingId(null);
		setEditTitle("");
	};

	const handleDeleteChat = (chatId: string) => {
		deleteChat.mutate({
			params: {
				path: { id: chatId },
			},
		});
		if (currentChatId === chatId) {
			clearMessages();
			onChatSelect?.("");
		}
	};

	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		const now = new Date();
		const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

		if (diffInHours < 1) {
			return "Just now";
		} else if (diffInHours < 24) {
			return `${Math.floor(diffInHours)}h ago`;
		} else if (diffInHours < 48) {
			return "Yesterday";
		} else {
			return format(date, "MMM d");
		}
	};

	const groupChatsByDate = (chats: Chat[]) => {
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		const lastWeek = new Date(today);
		lastWeek.setDate(lastWeek.getDate() - 7);

		const groups = {
			today: [] as Chat[],
			yesterday: [] as Chat[],
			lastWeek: [] as Chat[],
			older: [] as Chat[],
		};

		chats.forEach((chat) => {
			const chatDate = new Date(chat.updatedAt);
			if (chatDate.toDateString() === today.toDateString()) {
				groups.today.push(chat);
			} else if (chatDate.toDateString() === yesterday.toDateString()) {
				groups.yesterday.push(chat);
			} else if (chatDate >= lastWeek) {
				groups.lastWeek.push(chat);
			} else {
				groups.older.push(chat);
			}
		});

		return groups;
	};

	const chatGroups = groupChatsByDate(
		[...chats].sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		),
	);

	const renderChatGroup = (title: string, chats: Chat[]) => {
		if (chats.length === 0) {
			return null;
		}

		return (
			<div key={title} className="mb-4">
				<div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider group-data-[collapsible=icon]:hidden">
					{title}
				</div>

				<div className="space-y-1">
					{chats.map((chat) => (
						<SidebarMenuItem key={chat.id} className="relative">
							<SidebarMenuButton
								isActive={currentChatId === chat.id}
								onClick={() => onChatSelect?.(chat.id)}
								className="w-full justify-start gap-3 group relative pr-10 py-6"
								type="button"
								disabled={isPageLoading}
							>
								<MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
								{editingId === chat.id ? (
									<Input
										value={editTitle}
										onChange={(e) => setEditTitle(e.target.value)}
										onBlur={() => saveTitle(chat.id)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												saveTitle(chat.id);
											}
											if (e.key === "Escape") {
												setEditingId(null);
												setEditTitle("");
											}
										}}
										className="h-7 text-sm border-none px-1 focus-visible:ring-0 bg-transparent"
										autoFocus
									/>
								) : (
									<div className="flex-1 min-w-0">
										<div className="truncate text-sm font-medium mb-0.5">
											{chat.title}
										</div>
										<div className="text-xs text-muted-foreground">
											{chat.messageCount} messages •{" "}
											{formatDate(chat.updatedAt)}
										</div>
									</div>
								)}
							</SidebarMenuButton>
							{/* Action buttons */}
							{currentChatId === chat.id && editingId !== chat.id && (
								<div className="absolute right-0 top-2 bottom-0">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<SidebarMenuAction
												type="button"
												onClick={(e) => {
													e.stopPropagation();
												}}
												className="h-7 w-7 cursor-pointer"
											>
												<MoreVerticalIcon className="h-3.5 w-3.5" />
											</SidebarMenuAction>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-48">
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													handleEditTitle(chat);
												}}
												className="flex items-center gap-2"
											>
												<Edit2 className="h-4 w-4" />
												Rename
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={(e) => {
													e.stopPropagation();
													handleDeleteChat(chat.id);
												}}
												className="flex items-center gap-2 text-destructive focus:text-destructive"
											>
												<Trash2 className="h-4 w-4" />
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							)}
						</SidebarMenuItem>
					))}
				</div>
			</div>
		);
	};

	const isAuthenticated = !!user;

	// Loading auth state → show lightweight skeleton to avoid hydration issues
	if (isUserLoading) {
		return <ChatSidebarSkeleton organization={null} isOrgLoading={true} />;
	}

	// Unauthenticated → show CTA instead of org/project/chats UI
	if (!isAuthenticated) {
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
							<Badge>Chat</Badge>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to view organizations, projects, and chats.
							</p>
							<div className="flex items-center justify-end gap-2">
								<Button size="sm" asChild>
									<Link href="/login">Sign in</Link>
								</Button>
								<Button size="sm" variant="outline" asChild>
									<Link href="/signup">Create account</Link>
								</Button>
							</div>
						</div>
					</div>
				</SidebarHeader>
			</Sidebar>
		);
	}

	if (isChatsLoading || isOrgLoading) {
		return (
			<ChatSidebarSkeleton
				organization={selectedOrganization}
				isOrgLoading={isOrgLoading}
			/>
		);
	}

	return (
		<Sidebar collapsible="icon" className={className + " max-md:hidden"}>
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
					<SidebarMenuItem>
						<SidebarMenuButton
							onClick={onNewChat}
							disabled={isPageLoading}
							tooltip="New Chat"
							className="border border-border"
						>
							{isPageLoading ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Plus className="h-4 w-4" />
							)}
							<span>New Chat</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Chat"
							isActive={pathname === "/"}
						>
							<Link href="/">
								<MessageSquare className="h-4 w-4" />
								<span>Chat</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Group Chat"
							isActive={pathname === "/group"}
						>
							<Link href="/group">
								<Users className="h-4 w-4" />
								<span>Group Chat</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Image Studio"
							isActive={pathname === "/image"}
						>
							<Link href="/image">
								<ImagePlus className="h-4 w-4" />
								<span>Image Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Video Studio"
							isActive={pathname === "/video"}
						>
							<Link href="/video">
								<Film className="h-4 w-4" />
								<span>Video Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent className="px-2 py-4">
				{/* <SidebarMenu>
					<SidebarMenuItem>
						<OrganizationSwitcher
							organizations={organizations}
							selectedOrganization={selectedOrganization}
							onSelectOrganization={onSelectOrganization}
							onOrganizationCreated={onOrganizationCreated}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
				<SidebarMenu>
					<SidebarMenuItem>
						{selectedOrganization && (
							<ProjectSwitcher
								projects={projects}
								selectedProject={selectedProject}
								onSelectProject={onSelectProject}
								currentOrganization={selectedOrganization}
								onProjectCreated={onProjectCreated}
							/>
						)}
					</SidebarMenuItem>
				</SidebarMenu> */}
				<SidebarMenu>
					{renderChatGroup("Today", chatGroups.today)}
					{renderChatGroup("Yesterday", chatGroups.yesterday)}
					{renderChatGroup("Last 7 days", chatGroups.lastWeek)}
					{renderChatGroup("Older", chatGroups.older)}

					{chats.length === 0 && !isChatsLoading && (
						<div className="flex flex-col items-center justify-center py-8 text-center group-data-[collapsible=icon]:hidden">
							<MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
							<p className="text-sm text-muted-foreground mb-2">
								No chat history
							</p>
							<p className="text-xs text-muted-foreground">
								Start a new conversation to see it here
							</p>
						</div>
					)}
				</SidebarMenu>
			</SidebarContent>

			<SidebarFooter>
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={organization}
						isLoading={isOrgLoading}
					/>
				</div>
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
											{user?.name
												?.split(" ")
												.map((n: string) => n[0])
												.join("")
												.toUpperCase()
												.slice(0, 2) ?? "U"}
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
