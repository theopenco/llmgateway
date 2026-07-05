"use client";

import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
	AudioLines,
	MessageSquare,
	Edit2,
	Trash2,
	MoreVerticalIcon,
	ImagePlus,
	Film,
	Pin,
	PinOff,
	Users,
	ChevronDown,
	ChevronUp,
	Folder,
	LogOut,
	ExternalLink,
	PenTool,
} from "lucide-react";
// import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { List, type RowComponentProps } from "react-window";
import { toast } from "sonner";

import { CreditsDisplay } from "@/components/credits/credits-display";
import { ThemeToggle } from "@/components/landing/theme-toggle";
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
	useSidebar,
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
import { OrganizationSwitcher } from "./organization-switcher";
import { SidebarChatSearch, SidebarNewAction } from "./sidebar-actions";
// import { ProjectSwitcher } from "./project-switcher";

import type { Organization, Project } from "@/lib/types";

// const OrganizationSwitcher = dynamic(
// 	() => import("./organization-switcher").then((m) => m.OrganizationSwitcher),
// 	{ ssr: false },
// );

export interface ChatSidebarHandle {
	scrollToTop: () => void;
}

interface ChatSidebarProps {
	currentChatId?: string;
	onChatSelect?: (chatId: string) => void;
	onNewChat?: () => void;
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

type ChatHistoryRow =
	| { type: "header"; key: string; title: string }
	| { type: "chat"; key: string; chat: Chat }
	| { type: "spacer"; key: string };

const ROW_HEIGHT_HEADER = 28;
const ROW_HEIGHT_SPACER = 6;
const ROW_HEIGHT_CHAT = 52;

const HISTORY_COLLAPSED_STORAGE_KEY = "playground-chat-history-collapsed";

interface ChatHistoryRowProps {
	rows: ChatHistoryRow[];
	currentChatId?: string;
	editingId: string | null;
	editTitle: string;
	pendingFocusChatId: string | null;
	isPageLoading: boolean;
	isMobile: boolean;
	onChatSelect?: (chatId: string) => void;
	onEditTitleChange: (value: string) => void;
	onSaveTitle: (chatId: string) => void;
	onCancelEdit: () => void;
	onDeleteChat: (chatId: string) => void;
	onTogglePin: (chat: Chat) => void;
	onStartEdit: (chat: Chat) => void;
	onEditFocused: () => void;
}

function getChatHistoryRowHeight(
	index: number,
	{ rows }: ChatHistoryRowProps,
): number {
	const row = rows[index];

	if (row?.type === "header") {
		return ROW_HEIGHT_HEADER;
	}

	if (row?.type === "spacer") {
		return ROW_HEIGHT_SPACER;
	}

	return ROW_HEIGHT_CHAT;
}

function EditChatTitleInput({
	chatId,
	value,
	shouldFocus,
	onChange,
	onSave,
	onCancel,
	onFocused,
}: {
	chatId: string;
	value: string;
	shouldFocus: boolean;
	onChange: (value: string) => void;
	onSave: (chatId: string) => void;
	onCancel: () => void;
	onFocused: () => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (
			!shouldFocus ||
			!inputRef.current ||
			document.activeElement === inputRef.current
		) {
			return;
		}
		const el = inputRef.current;
		el.focus();
		const len = el.value.length;
		el.setSelectionRange(len, len);
		onFocused();
	}, [shouldFocus, onFocused]);

	return (
		<Input
			ref={inputRef}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			onBlur={() => onSave(chatId)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					e.currentTarget.blur();
				}
				if (e.key === "Escape") {
					e.preventDefault();
					onCancel();
				}
			}}
			className="h-7 text-sm border-none px-1 focus-visible:ring-0 bg-transparent"
		/>
	);
}

type ChatHistoryItemProps = Pick<
	ChatHistoryRowProps,
	| "currentChatId"
	| "editingId"
	| "editTitle"
	| "pendingFocusChatId"
	| "isPageLoading"
	| "isMobile"
	| "onChatSelect"
	| "onEditTitleChange"
	| "onSaveTitle"
	| "onCancelEdit"
	| "onDeleteChat"
	| "onTogglePin"
	| "onStartEdit"
	| "onEditFocused"
> & { chat: Chat };

function ChatHistoryItem({
	chat,
	currentChatId,
	editingId,
	editTitle,
	pendingFocusChatId,
	isPageLoading,
	isMobile,
	onChatSelect,
	onEditTitleChange,
	onSaveTitle,
	onCancelEdit,
	onDeleteChat,
	onTogglePin,
	onStartEdit,
	onEditFocused,
}: ChatHistoryItemProps) {
	const isEditing = editingId === chat.id;
	const isActive = currentChatId === chat.id;
	const isActionFocusable = isActive && isMobile ? undefined : -1;

	return (
		<div className="relative h-full px-2 pb-1">
			<div className="group/chat-row relative h-full">
				{isEditing ? (
					<div className="flex h-full w-full items-center rounded-md px-2 pr-8 text-left text-sm ring-sidebar-ring bg-sidebar-accent text-sidebar-accent-foreground">
						<EditChatTitleInput
							chatId={chat.id}
							value={editTitle}
							shouldFocus={pendingFocusChatId === chat.id}
							onChange={onEditTitleChange}
							onSave={onSaveTitle}
							onCancel={onCancelEdit}
							onFocused={onEditFocused}
						/>
					</div>
				) : (
					<SidebarMenuButton
						isActive={isActive}
						onClick={() => onChatSelect?.(chat.id)}
						className={[
							"h-full! w-full justify-start group relative pr-2 !transition-none group-hover/chat-row:pr-[4.5rem]",
							isActive ? "max-md:pr-[4.5rem]" : "",
						].join(" ")}
						type="button"
						disabled={isPageLoading}
					>
						<div className="flex-1 min-w-0">
							<div className="truncate text-sm font-medium mb-0.5">
								{chat.title}
							</div>
							<div className="text-xs text-muted-foreground">
								{chat.messageCount} messages • {formatDate(chat.updatedAt)}
							</div>
						</div>
					</SidebarMenuButton>
				)}
				{!isEditing && (
					<div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
						<button
							type="button"
							aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
							title={chat.pinned ? "Unpin chat" : "Pin chat"}
							tabIndex={isActionFocusable}
							onClick={(e) => {
								e.stopPropagation();
								onTogglePin(chat);
							}}
							className={[
								"flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
								"pointer-events-none opacity-0 group-hover/chat-row:pointer-events-auto group-hover/chat-row:opacity-100",
								isActive ? "max-md:pointer-events-auto max-md:opacity-100" : "",
							].join(" ")}
						>
							{chat.pinned ? (
								<PinOff className="h-3.5 w-3.5" />
							) : (
								<Pin className="h-3.5 w-3.5" />
							)}
						</button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<SidebarMenuAction
									type="button"
									tabIndex={isActionFocusable}
									onClick={(e) => {
										e.stopPropagation();
									}}
									className={[
										"pointer-events-none static hidden h-7 w-7 cursor-pointer opacity-0 group-hover/chat-row:flex group-hover/chat-row:pointer-events-auto group-hover/chat-row:opacity-100 data-[state=open]:flex data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
										isActive
											? "max-md:flex max-md:pointer-events-auto max-md:opacity-100"
											: "",
									].join(" ")}
								>
									<MoreVerticalIcon className="h-3.5 w-3.5" />
								</SidebarMenuAction>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-48">
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onTogglePin(chat);
									}}
									className="flex items-center gap-2"
								>
									{chat.pinned ? (
										<PinOff className="h-4 w-4" />
									) : (
										<Pin className="h-4 w-4" />
									)}
									{chat.pinned ? "Unpin" : "Pin"}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onStartEdit(chat);
									}}
									className="flex items-center gap-2"
								>
									<Edit2 className="h-4 w-4" />
									Rename
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onDeleteChat(chat.id);
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
			</div>
		</div>
	);
}

function ChatHistoryRowComponent({
	ariaAttributes,
	index,
	style,
	rows,
	currentChatId,
	editingId,
	editTitle,
	pendingFocusChatId,
	isPageLoading,
	isMobile,
	onChatSelect,
	onEditTitleChange,
	onSaveTitle,
	onCancelEdit,
	onDeleteChat,
	onTogglePin,
	onStartEdit,
	onEditFocused,
}: RowComponentProps<ChatHistoryRowProps>) {
	const row = rows[index];

	if (!row) {
		return null;
	}

	if (row.type === "spacer") {
		return <div style={style} aria-hidden="true" />;
	}

	if (row.type === "header") {
		return (
			<div {...ariaAttributes} style={style}>
				<div className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider group-data-[collapsible=icon]:hidden">
					{row.title}
				</div>
			</div>
		);
	}

	return (
		<div {...ariaAttributes} style={style}>
			<ChatHistoryItem
				chat={row.chat}
				currentChatId={currentChatId}
				editingId={editingId}
				editTitle={editTitle}
				pendingFocusChatId={pendingFocusChatId}
				isPageLoading={isPageLoading}
				isMobile={isMobile}
				onChatSelect={onChatSelect}
				onEditTitleChange={onEditTitleChange}
				onSaveTitle={onSaveTitle}
				onCancelEdit={onCancelEdit}
				onDeleteChat={onDeleteChat}
				onTogglePin={onTogglePin}
				onStartEdit={onStartEdit}
				onEditFocused={onEditFocused}
			/>
		</div>
	);
}

function formatDate(dateString: string): string {
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
}

function groupChatsByDate(chats: Chat[]) {
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
}

export const ChatSidebar = function ChatSidebar({
	ref,
	currentChatId,
	onChatSelect,
	onNewChat,
	className,
	isLoading: isPageLoading = false,
	organizations,
	selectedOrganization,
	onSelectOrganization,
}: ChatSidebarProps & { ref?: React.RefObject<ChatSidebarHandle | null> }) {
	const listContainerRef = useRef<HTMLDivElement | null>(null);

	useImperativeHandle(ref, () => ({
		scrollToTop: () => {
			const scrollEl = listContainerRef.current
				?.firstElementChild as HTMLElement | null;
			scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
		},
	}));

	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	// Preserve the selected organization across playground navigation so users
	// don't have to re-pick their org on every page.
	const orgIdParam = searchParams.get("orgId");
	const withOrg = (path: string) =>
		orgIdParam ? `${path}?orgId=${orgIdParam}` : path;
	const posthog = usePostHog();
	const { state: sidebarState, isMobile, setOpenMobile } = useSidebar();
	const showOrganizationSwitcher = pathname === "/" || pathname === "/group";
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();
	const { organization, isLoading: isOrgLoading } = useOrganization();
	const { theme, setTheme, systemTheme } = useTheme();

	// Resolve the org context for chat history: the selected org, or the
	// dedicated Chat org (backing the "Chat plan" context) when none is selected.
	const resolvedOrgId = selectedOrganization?.id ?? organization?.id;

	// Use real chat data from API, scoped to the resolved organization context.
	const { data: chatsData, isLoading: isChatsLoading } =
		useChats(resolvedOrgId);
	const deleteChat = useDeleteChat();
	const updateChat = useUpdateChat();

	const [editingId, setEditingId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");
	// chatId that needs initial focus. Cleared once the row delivers focus,
	// so re-mounting the row on scroll never re-steals focus mid-edit.
	const [pendingFocusChatId, setPendingFocusChatId] = useState<string | null>(
		null,
	);
	const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(
		() =>
			typeof document !== "undefined" &&
			document.cookie
				.split("; ")
				.includes(`${HISTORY_COLLAPSED_STORAGE_KEY}=1`),
	);

	const toggleHistoryCollapsed = useCallback(() => {
		setIsHistoryCollapsed((prev) => {
			const next = !prev;
			document.cookie = `${HISTORY_COLLAPSED_STORAGE_KEY}=${
				next ? "1" : "0"
			}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
			return next;
		});
	}, []);

	const chats = useMemo(() => chatsData?.chats ?? [], [chatsData?.chats]);
	const currentTheme = theme === "system" ? systemTheme : theme;
	const toggleTheme = useCallback(() => {
		setTheme(currentTheme === "dark" ? "light" : "dark");
	}, [currentTheme, setTheme]);

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

	const handleEditTitle = useCallback((chat: Chat) => {
		setEditingId(chat.id);
		setEditTitle(chat.title);
		setPendingFocusChatId(chat.id);
	}, []);

	const saveTitle = useCallback(
		(chatId: string) => {
			const nextTitle = editTitle.trim();
			const currentTitle = chats
				.find((chat) => chat.id === chatId)
				?.title.trim();

			if (nextTitle && nextTitle !== currentTitle) {
				updateChat.mutate({
					params: {
						path: { id: chatId },
					},
					body: { title: nextTitle },
				});
			}
			setEditingId(null);
			setEditTitle("");
			setPendingFocusChatId(null);
		},
		[chats, editTitle, updateChat],
	);

	const cancelEditTitle = useCallback(() => {
		setEditingId(null);
		setEditTitle("");
		setPendingFocusChatId(null);
	}, []);

	const handleDeleteChat = useCallback(
		(chatId: string) => {
			deleteChat.mutate({
				params: {
					path: { id: chatId },
				},
			});
			if (currentChatId === chatId) {
				onNewChat?.();
			}
		},
		[deleteChat, currentChatId, onNewChat],
	);

	const handleChatSelect = useCallback(
		(chatId: string) => {
			onChatSelect?.(chatId);

			if (isMobile) {
				setOpenMobile(false);
			}
		},
		[isMobile, onChatSelect, setOpenMobile],
	);

	const handleTogglePin = useCallback(
		(chat: Chat) => {
			updateChat.mutate({
				params: {
					path: { id: chat.id },
				},
				body: { pinned: !chat.pinned },
			});
		},
		[updateChat],
	);

	const onEditFocused = useCallback(() => {
		setPendingFocusChatId(null);
	}, []);

	const sortedChats = useMemo(
		() =>
			[...chats].sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			),
		[chats],
	);

	const pinnedChats = useMemo(
		() => sortedChats.filter((chat) => chat.pinned),
		[sortedChats],
	);

	const chatGroups = useMemo(
		() => groupChatsByDate(sortedChats.filter((chat) => !chat.pinned)),
		[sortedChats],
	);

	const historyRows = useMemo<ChatHistoryRow[]>(() => {
		const groups: Array<{ title: string; chats: Chat[] }> = [
			{ title: "Today", chats: chatGroups.today },
			{ title: "Yesterday", chats: chatGroups.yesterday },
			{ title: "Last 7 days", chats: chatGroups.lastWeek },
			{ title: "Older", chats: chatGroups.older },
		];
		const rows: ChatHistoryRow[] = [];

		// Pinned chats render in a separate sticky block above the scrollable
		// list (see render), so they are intentionally excluded here.
		groups.forEach(({ title, chats: groupedChats }, groupIndex) => {
			if (groupedChats.length === 0) {
				return;
			}

			rows.push({ type: "header", key: `header-${title}`, title });

			groupedChats.forEach((chat) => {
				rows.push({ type: "chat", key: `chat-${chat.id}`, chat });
			});

			const hasNextGroupWithChats = groups
				.slice(groupIndex + 1)
				.some((group) => group.chats.length > 0);

			if (hasNextGroupWithChats) {
				rows.push({ type: "spacer", key: `spacer-${title}` });
			}
		});

		return rows;
	}, [chatGroups]);

	const rowProps = useMemo<ChatHistoryRowProps>(
		() => ({
			rows: historyRows,
			currentChatId,
			editingId,
			editTitle,
			pendingFocusChatId,
			isPageLoading,
			isMobile,
			onChatSelect: handleChatSelect,
			onEditTitleChange: setEditTitle,
			onSaveTitle: saveTitle,
			onCancelEdit: cancelEditTitle,
			onDeleteChat: handleDeleteChat,
			onTogglePin: handleTogglePin,
			onStartEdit: handleEditTitle,
			onEditFocused,
		}),
		[
			historyRows,
			currentChatId,
			editingId,
			editTitle,
			pendingFocusChatId,
			isPageLoading,
			isMobile,
			handleChatSelect,
			saveTitle,
			cancelEditTitle,
			handleDeleteChat,
			handleTogglePin,
			handleEditTitle,
			onEditFocused,
		],
	);

	const isAuthenticated = !!user;
	const isHistoryHidden = sidebarState === "collapsed" && !isMobile;

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
							<Link href={withOrg("/")} prefetch={true}>
								<div className="flex aspect-square size-8 items-center justify-center">
									<Logo className="size-6" />
								</div>
								<span className="text-lg font-bold tracking-tight">
									LLM Gateway
								</span>
								<Badge
									variant="secondary"
									className="group-data-[collapsible=icon]:hidden"
								>
									Chat
								</Badge>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarChatSearch
						disabled={pathname !== "/"}
						onChatSelect={handleChatSelect}
						onNewChat={onNewChat}
					/>
					<SidebarNewAction
						label="New Chat"
						onAction={onNewChat}
						isLoading={isPageLoading}
					/>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Chat"
							isActive={pathname === "/"}
						>
							<Link href={withOrg("/")} prefetch={true}>
								<MessageSquare className="h-4 w-4" />
								<span>Chat</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Projects"
							isActive={pathname === "/projects"}
						>
							<Link href={withOrg("/projects")} prefetch={true}>
								<Folder className="h-4 w-4" />
								<span>Projects</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Group Chat"
							isActive={pathname === "/group"}
						>
							<Link href={withOrg("/group")} prefetch={true}>
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
							<Link href={withOrg("/image")} prefetch={true}>
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
							<Link href={withOrg("/video")} prefetch={true}>
								<Film className="h-4 w-4" />
								<span>Video Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Audio Studio"
							isActive={pathname === "/audio"}
						>
							<Link href={withOrg("/audio")} prefetch={true}>
								<AudioLines className="h-4 w-4" />
								<span>Audio Studio</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="Canvas"
							isActive={pathname === "/canvas"}
						>
							<Link href={withOrg("/canvas")} prefetch={true}>
								<PenTool className="h-4 w-4" />
								<span>Canvas</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent className="overflow-hidden pb-2">
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
				<div>
					<div className="mx-2 mb-2 border-t border-sidebar-border" />
					{organizations.length > 0 && showOrganizationSwitcher ? (
						<>
							<SidebarMenu className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
								<SidebarMenuItem>
									<OrganizationSwitcher
										organizations={organizations}
										selectedOrganization={selectedOrganization}
										onSelectOrganization={onSelectOrganization}
									/>
								</SidebarMenuItem>
							</SidebarMenu>
						</>
					) : null}
				</div>
				<div
					ref={listContainerRef}
					aria-hidden={isHistoryHidden}
					className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
				>
					<button
						type="button"
						onClick={toggleHistoryCollapsed}
						aria-expanded={!isHistoryCollapsed}
						className="flex w-full shrink-0 items-center justify-between px-5 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground group-data-[collapsible=icon]:hidden"
					>
						<span>Chats</span>
						<ChevronDown
							className={`h-3.5 w-3.5 transition-transform duration-200 ${
								isHistoryCollapsed ? "-rotate-90" : ""
							}`}
						/>
					</button>
					{isHistoryCollapsed ? null : chats.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
							<p className="text-sm text-muted-foreground mb-2">
								No chat history
							</p>
							<p className="text-xs text-muted-foreground">
								Start a new conversation to see it here
							</p>
						</div>
					) : (
						<>
							{pinnedChats.length > 0 && (
								<div className="shrink-0 max-h-[45%] overflow-y-auto border-b border-sidebar-border/60 pb-1">
									<div className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider group-data-[collapsible=icon]:hidden">
										Pinned
									</div>
									{pinnedChats.map((chat) => (
										<div key={chat.id} style={{ height: ROW_HEIGHT_CHAT }}>
											<ChatHistoryItem
												chat={chat}
												currentChatId={currentChatId}
												editingId={editingId}
												editTitle={editTitle}
												pendingFocusChatId={pendingFocusChatId}
												isPageLoading={isPageLoading}
												isMobile={isMobile}
												onChatSelect={handleChatSelect}
												onEditTitleChange={setEditTitle}
												onSaveTitle={saveTitle}
												onCancelEdit={cancelEditTitle}
												onDeleteChat={handleDeleteChat}
												onTogglePin={handleTogglePin}
												onStartEdit={handleEditTitle}
												onEditFocused={onEditFocused}
											/>
										</div>
									))}
								</div>
							)}
							{historyRows.length > 0 && (
								<List
									className="min-h-0 w-full flex-1"
									style={{ width: "100%" }}
									rowComponent={ChatHistoryRowComponent}
									rowCount={historyRows.length}
									rowHeight={getChatHistoryRowHeight}
									rowProps={rowProps}
									overscanCount={8}
								/>
							)}
						</>
					)}
				</div>
			</SidebarContent>

			<SidebarFooter>
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={
							!selectedOrganization || selectedOrganization.kind === "chat"
								? organization
								: selectedOrganization
						}
						isLoading={isOrgLoading}
						isChatPlanOrg={
							!selectedOrganization || selectedOrganization.kind === "chat"
						}
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
								<DropdownMenuItem
									className="justify-between gap-3"
									onSelect={(event) => {
										event.preventDefault();
										toggleTheme();
									}}
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
};
