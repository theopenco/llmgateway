"use client";

import {
	AudioLines,
	ChevronUp,
	Edit2,
	ExternalLink,
	Film,
	ImageIcon,
	LogOut,
	MessageSquare,
	MoreVerticalIcon,
	PenTool,
	Trash2,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";

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
import { useOrganization } from "@/hooks/useOrganization";
import {
	useDeleteAudioHistory,
	useRenameAudioHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";

import { HistorySkeleton } from "./history-skeleton";
import { OrganizationSwitcher } from "./organization-switcher";
import { SidebarChatSearch, SidebarNewAction } from "./sidebar-actions";

import type { AudioGalleryItem } from "@/lib/audio-gen";
import type { Organization } from "@/lib/types";

interface AudioSidebarProps {
	galleryItems: AudioGalleryItem[];
	isHistoryLoading?: boolean;
	onNewChat: () => void;
	onItemClick: (itemId: string) => void;
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (organization: Organization | null) => void;
	currentItemId?: string | null;
	className?: string;
}

type AudioHistoryRow =
	| { type: "header"; key: string; title: string }
	| { type: "item"; key: string; item: AudioGalleryItem }
	| { type: "spacer"; key: string };

const ROW_HEIGHT_HEADER = 28;
const ROW_HEIGHT_SPACER = 6;
const ROW_HEIGHT_ITEM = 60;

interface AudioHistoryRowProps {
	rows: AudioHistoryRow[];
	currentItemId?: string | null;
	editingId: string | null;
	editPrompt: string;
	pendingFocusId: string | null;
	onItemClick: (itemId: string) => void;
	onEditPromptChange: (value: string) => void;
	onSaveEdit: (id: string, original: string) => void;
	onCancelEdit: () => void;
	onDeleteItem: (id: string) => void;
	onStartEdit: (id: string, prompt: string) => void;
	onEditFocused: () => void;
}

function getAudioHistoryRowHeight(
	index: number,
	{ rows }: AudioHistoryRowProps,
): number {
	const row = rows[index];

	if (row?.type === "header") {
		return ROW_HEIGHT_HEADER;
	}

	if (row?.type === "spacer") {
		return ROW_HEIGHT_SPACER;
	}

	return ROW_HEIGHT_ITEM;
}

function EditAudioPromptInput({
	itemId,
	value,
	original,
	shouldFocus,
	onChange,
	onSave,
	onCancel,
	onFocused,
}: {
	itemId: string;
	value: string;
	original: string;
	shouldFocus: boolean;
	onChange: (value: string) => void;
	onSave: (id: string, original: string) => void;
	onCancel: () => void;
	onFocused: () => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	// Guards against a blur firing after Escape canceled the edit, so the
	// cancel can't be overridden by a save.
	const canceledRef = useRef(false);

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
			onBlur={() => {
				if (!canceledRef.current) {
					onSave(itemId, original);
				}
				canceledRef.current = false;
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					e.currentTarget.blur();
				}
				if (e.key === "Escape") {
					e.preventDefault();
					canceledRef.current = true;
					onCancel();
				}
			}}
			className="h-7 text-sm border-none px-1 focus-visible:ring-0 bg-transparent"
		/>
	);
}

function AudioHistoryRowComponent({
	ariaAttributes,
	index,
	style,
	rows,
	currentItemId,
	editingId,
	editPrompt,
	pendingFocusId,
	onItemClick,
	onEditPromptChange,
	onSaveEdit,
	onCancelEdit,
	onDeleteItem,
	onStartEdit,
	onEditFocused,
}: RowComponentProps<AudioHistoryRowProps>) {
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

	const { item } = row;
	const isEditing = editingId === item.id;
	const isActive = currentItemId === item.id;
	const isSaved = item.models.every((m) => !m.isLoading);

	return (
		<div {...ariaAttributes} style={style}>
			<div className="relative h-full px-2 pb-1">
				<div className="group/audio-row relative h-full">
					{isEditing ? (
						<div className="flex h-full w-full items-center rounded-md px-2 pr-8 text-left text-sm ring-sidebar-ring bg-sidebar-accent text-sidebar-accent-foreground">
							<EditAudioPromptInput
								itemId={item.id}
								value={editPrompt}
								original={item.prompt}
								shouldFocus={pendingFocusId === item.id}
								onChange={onEditPromptChange}
								onSave={onSaveEdit}
								onCancel={onCancelEdit}
								onFocused={onEditFocused}
							/>
						</div>
					) : (
						<SidebarMenuButton
							onClick={() => onItemClick(item.id)}
							isActive={isActive}
							className="h-full! w-full justify-start group relative pr-2 !transition-none group-hover/audio-row:pr-9"
							type="button"
						>
							<div className="flex items-start gap-2 min-w-0 w-full">
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border mt-0.5">
									<AudioLines className="h-4 w-4 text-muted-foreground" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="truncate text-sm font-medium mb-0.5">
										{item.prompt}
									</div>
									<div className="text-xs text-muted-foreground">
										{new Date(item.timestamp).toLocaleTimeString([], {
											hour: "numeric",
											minute: "2-digit",
										})}
									</div>
								</div>
							</div>
						</SidebarMenuButton>
					)}
					{!isEditing && isSaved && (
						<div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<SidebarMenuAction
										type="button"
										onClick={(e) => {
											e.stopPropagation();
										}}
										className="pointer-events-none static hidden h-7 w-7 cursor-pointer opacity-0 group-hover/audio-row:flex group-hover/audio-row:pointer-events-auto group-hover/audio-row:opacity-100 data-[state=open]:flex data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
									>
										<MoreVerticalIcon className="h-3.5 w-3.5" />
									</SidebarMenuAction>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-40">
									<DropdownMenuItem
										onClick={(e) => {
											e.stopPropagation();
											onStartEdit(item.id, item.prompt);
										}}
										className="flex items-center gap-2"
									>
										<Edit2 className="h-4 w-4" />
										Rename
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={(e) => {
											e.stopPropagation();
											onDeleteItem(item.id);
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
		</div>
	);
}

function groupItemsByDate(items: AudioGalleryItem[]) {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(today);
	lastWeek.setDate(lastWeek.getDate() - 7);

	const groups = {
		today: [] as AudioGalleryItem[],
		yesterday: [] as AudioGalleryItem[],
		lastWeek: [] as AudioGalleryItem[],
		older: [] as AudioGalleryItem[],
	};

	items.forEach((item) => {
		const itemDate = new Date(item.timestamp);
		if (itemDate.toDateString() === today.toDateString()) {
			groups.today.push(item);
		} else if (itemDate.toDateString() === yesterday.toDateString()) {
			groups.yesterday.push(item);
		} else if (itemDate >= lastWeek) {
			groups.lastWeek.push(item);
		} else {
			groups.older.push(item);
		}
	});

	return groups;
}

export function AudioSidebar({
	galleryItems,
	isHistoryLoading = false,
	onNewChat,
	onItemClick,
	organizations,
	selectedOrganization,
	onSelectOrganization,
	currentItemId,
	className,
}: AudioSidebarProps) {
	const switcherOrganizations = organizations.filter(
		(org) => org.kind === "default",
	);
	const switcherSelectedOrganization =
		switcherOrganizations.find((org) => org.id === selectedOrganization?.id) ??
		null;
	const listContainerRef = useRef<HTMLDivElement | null>(null);
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	// Preserve the selected organization across playground navigation so users
	// don't have to re-pick their org on every page.
	const orgIdParam = searchParams.get("orgId");
	const withOrg = (path: string) =>
		orgIdParam ? `${path}?orgId=${orgIdParam}` : path;
	const posthog = usePostHog();
	const { state: sidebarState, isMobile } = useSidebar();
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();
	const { organization, isLoading: isOrgLoading } = useOrganization();

	const logout = async () => {
		posthog.reset();
		try {
			await clearLastUsedProjectCookiesAction();
		} catch {
			// ignore
		}
		await signOut({
			fetchOptions: {
				onSuccess: () => {
					router.push(
						process.env.NODE_ENV === "development"
							? "http://localhost:3003/login"
							: "https://chat.llmgateway.io/login",
					);
				},
			},
		});
	};

	const renameItem = useRenameAudioHistory();
	const deleteItem = useDeleteAudioHistory();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editPrompt, setEditPrompt] = useState("");
	const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

	const startEdit = useCallback((id: string, prompt: string) => {
		setEditingId(id);
		setEditPrompt(prompt);
		setPendingFocusId(id);
	}, []);

	const saveEdit = useCallback(
		(id: string, original: string) => {
			const next = editPrompt.trim();
			if (next && next !== original) {
				renameItem.mutate({
					params: { path: { id } },
					body: { prompt: next },
				});
			}
			setEditingId(null);
			setEditPrompt("");
			setPendingFocusId(null);
		},
		[editPrompt, renameItem],
	);

	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setEditPrompt("");
		setPendingFocusId(null);
	}, []);

	const handleDeleteItem = useCallback(
		(id: string) => {
			deleteItem.mutate({
				params: { path: { id } },
			});
		},
		[deleteItem],
	);

	const onEditFocused = useCallback(() => {
		setPendingFocusId(null);
	}, []);

	const sortedItems = useMemo(
		() => [...galleryItems].sort((a, b) => b.timestamp - a.timestamp),
		[galleryItems],
	);

	const itemGroups = useMemo(
		() => groupItemsByDate(sortedItems),
		[sortedItems],
	);

	const historyRows = useMemo<AudioHistoryRow[]>(() => {
		const groups: Array<{ title: string; items: AudioGalleryItem[] }> = [
			{ title: "Today", items: itemGroups.today },
			{ title: "Yesterday", items: itemGroups.yesterday },
			{ title: "Last 7 days", items: itemGroups.lastWeek },
			{ title: "Older", items: itemGroups.older },
		];
		const rows: AudioHistoryRow[] = [];

		groups.forEach(({ title, items: groupedItems }, groupIndex) => {
			if (groupedItems.length === 0) {
				return;
			}

			rows.push({ type: "header", key: `header-${title}`, title });

			groupedItems.forEach((item) => {
				rows.push({ type: "item", key: `item-${item.id}`, item });
			});

			const hasNextGroupWithItems = groups
				.slice(groupIndex + 1)
				.some((group) => group.items.length > 0);

			if (hasNextGroupWithItems) {
				rows.push({ type: "spacer", key: `spacer-${title}` });
			}
		});

		return rows;
	}, [itemGroups]);

	const rowProps = useMemo<AudioHistoryRowProps>(
		() => ({
			rows: historyRows,
			currentItemId,
			editingId,
			editPrompt,
			pendingFocusId,
			onItemClick,
			onEditPromptChange: setEditPrompt,
			onSaveEdit: saveEdit,
			onCancelEdit: cancelEdit,
			onDeleteItem: handleDeleteItem,
			onStartEdit: startEdit,
			onEditFocused,
		}),
		[
			historyRows,
			currentItemId,
			editingId,
			editPrompt,
			pendingFocusId,
			onItemClick,
			saveEdit,
			cancelEdit,
			handleDeleteItem,
			startEdit,
			onEditFocused,
		],
	);

	const isAuthenticated = !!user;
	const isHistoryHidden = sidebarState === "collapsed" && !isMobile;

	if (isUserLoading) {
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
							<Badge>Audio</Badge>
						</Link>
					</div>
				</SidebarHeader>
			</Sidebar>
		);
	}

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
							<Badge>Audio</Badge>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to generate audio.
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

	return (
		<Sidebar
			collapsible="icon"
			className={(className ?? "") + " max-md:hidden"}
		>
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
					<SidebarChatSearch disabled />
					<SidebarNewAction label="New Generation" onAction={onNewChat} />
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
								<ImageIcon className="h-4 w-4" />
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
				<div>
					<div className="mx-2 mb-2 border-t border-sidebar-border" />
					{switcherOrganizations.length > 0 ? (
						<SidebarMenu className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
							<SidebarMenuItem>
								<OrganizationSwitcher
									organizations={switcherOrganizations}
									selectedOrganization={switcherSelectedOrganization}
									onSelectOrganization={onSelectOrganization}
								/>
							</SidebarMenuItem>
						</SidebarMenu>
					) : null}
				</div>
				<div
					ref={listContainerRef}
					aria-hidden={isHistoryHidden}
					className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
				>
					{isHistoryLoading && galleryItems.length === 0 ? (
						<HistorySkeleton withThumbnail />
					) : galleryItems.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<AudioLines className="h-12 w-12 text-muted-foreground/50 mb-4" />
							<p className="text-sm text-muted-foreground mb-2">
								No generation history
							</p>
							<p className="text-xs text-muted-foreground">
								Generate audio to see it here
							</p>
						</div>
					) : (
						<List
							className="min-h-0 w-full flex-1"
							style={{ width: "100%" }}
							rowComponent={AudioHistoryRowComponent}
							rowCount={historyRows.length}
							rowHeight={getAudioHistoryRowHeight}
							rowProps={rowProps}
							overscanCount={8}
						/>
					)}
				</div>
			</SidebarContent>

			<SidebarFooter>
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={switcherSelectedOrganization ?? organization}
						isLoading={isOrgLoading}
						isChatPlanOrg={!switcherSelectedOrganization}
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
