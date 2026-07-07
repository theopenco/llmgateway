"use client";

import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
	AudioLines,
	MessageSquare,
	ChevronUp,
	LogOut,
	ExternalLink,
	Search,
	Plus,
	Users,
	ImagePlus,
	Film,
	PenTool,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useOrgShares } from "@/hooks/useChats";
import { useOrganization } from "@/hooks/useOrganization";
import { useUser } from "@/hooks/useUser";
import { clearLastUsedProjectCookiesAction } from "@/lib/actions/project";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

import { ChatSidebarSkeleton } from "./chat-sidebar-skeleton";
import { OrgSearchDialog } from "./org-search-dialog";
import { OrganizationSwitcher } from "./organization-switcher";

import type { Organization } from "@/lib/types";

interface OrgSidebarProps {
	organizationId: string;
	currentShareId?: string;
	organizations: Organization[];
	selectedOrganization: Organization | null;
	onSelectOrganization: (org: Organization | null) => void;
	className?: string;
}

interface OrgShareItem {
	id: string;
	title: string;
	model: string;
	createdAt: string;
	updatedAt: string;
}

type OrgShareHistoryRow =
	| { type: "header"; key: string; title: string }
	| { type: "share"; key: string; share: OrgShareItem }
	| { type: "spacer"; key: string };

const ROW_HEIGHT_HEADER = 32;
const ROW_HEIGHT_SPACER = 16;
const ROW_HEIGHT_SHARE = 60;

interface OrgShareHistoryRowProps {
	rows: OrgShareHistoryRow[];
	currentShareId?: string;
	onShareSelect: (shareId: string) => void;
}

function getOrgShareRowHeight(
	index: number,
	{ rows }: OrgShareHistoryRowProps,
): number {
	const row = rows[index];
	if (row?.type === "header") {
		return ROW_HEIGHT_HEADER;
	}
	if (row?.type === "spacer") {
		return ROW_HEIGHT_SPACER;
	}
	return ROW_HEIGHT_SHARE;
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

function groupSharesByDate(shares: OrgShareItem[]) {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(today);
	lastWeek.setDate(lastWeek.getDate() - 7);

	const groups = {
		today: [] as OrgShareItem[],
		yesterday: [] as OrgShareItem[],
		lastWeek: [] as OrgShareItem[],
		older: [] as OrgShareItem[],
	};

	shares.forEach((share) => {
		const shareDate = new Date(share.updatedAt);
		if (shareDate.toDateString() === today.toDateString()) {
			groups.today.push(share);
		} else if (shareDate.toDateString() === yesterday.toDateString()) {
			groups.yesterday.push(share);
		} else if (shareDate >= lastWeek) {
			groups.lastWeek.push(share);
		} else {
			groups.older.push(share);
		}
	});

	return groups;
}

function OrgShareRowComponent({
	ariaAttributes,
	index,
	style,
	rows,
	currentShareId,
	onShareSelect,
}: RowComponentProps<OrgShareHistoryRowProps>) {
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

	const { share } = row;

	return (
		<div {...ariaAttributes} style={style}>
			<div className="relative h-full px-2 pb-1">
				<div className="relative h-full">
					<SidebarMenuButton
						isActive={currentShareId === share.id}
						onClick={() => onShareSelect(share.id)}
						className="h-full! w-full justify-start gap-3 group relative"
						type="button"
					>
						<MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
						<div className="flex-1 min-w-0">
							<div className="truncate text-sm font-medium mb-0.5">
								{share.title}
							</div>
							<div className="text-xs text-muted-foreground">
								{formatDate(share.updatedAt)}
							</div>
						</div>
					</SidebarMenuButton>
				</div>
			</div>
		</div>
	);
}

export function OrgSidebar({
	organizationId,
	currentShareId,
	organizations,
	selectedOrganization,
	onSelectOrganization,
	className,
}: OrgSidebarProps) {
	const listContainerRef = useRef<HTMLDivElement | null>(null);
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const { state: sidebarState, isMobile } = useSidebar();
	const { user, isLoading: isUserLoading } = useUser();
	const { signOut } = useAuth();
	const { isLoading: isOrgLoading } = useOrganization();

	const { data: orgSharesData, isLoading: isSharesLoading } =
		useOrgShares(organizationId);

	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isMac, setIsMac] = useState(false);

	const shares = useMemo<OrgShareItem[]>(
		() => orgSharesData?.shares ?? [],
		[orgSharesData?.shares],
	);

	useEffect(() => {
		setIsMac(/(Mac|iPhone|iPad|iPod)/i.test(window.navigator.platform));
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			const isSearchShortcut = isMac
				? event.metaKey && key === "k" && !event.altKey && !event.ctrlKey
				: event.altKey && key === "k" && !event.metaKey && !event.ctrlKey;

			if (!isSearchShortcut || event.shiftKey || event.defaultPrevented) {
				return;
			}

			event.preventDefault();
			setIsSearchOpen(true);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isMac]);

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

	const handleShareSelect = useCallback(
		(shareId: string) => {
			router.push(`/org/${organizationId}/chat/${shareId}`);
		},
		[organizationId, router],
	);

	const shareGroups = useMemo(
		() =>
			groupSharesByDate(
				[...shares].sort(
					(a, b) =>
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				),
			),
		[shares],
	);

	const historyRows = useMemo<OrgShareHistoryRow[]>(() => {
		const groups: Array<{ title: string; shares: OrgShareItem[] }> = [
			{ title: "Today", shares: shareGroups.today },
			{ title: "Yesterday", shares: shareGroups.yesterday },
			{ title: "Last 7 days", shares: shareGroups.lastWeek },
			{ title: "Older", shares: shareGroups.older },
		];
		const rows: OrgShareHistoryRow[] = [];

		groups.forEach(({ title, shares: groupedShares }, groupIndex) => {
			if (groupedShares.length === 0) {
				return;
			}

			rows.push({ type: "header", key: `header-${title}`, title });
			groupedShares.forEach((share) => {
				rows.push({ type: "share", key: `share-${share.id}`, share });
			});

			const hasNextGroupWithShares = groups
				.slice(groupIndex + 1)
				.some((group) => group.shares.length > 0);

			if (hasNextGroupWithShares) {
				rows.push({ type: "spacer", key: `spacer-${title}` });
			}
		});

		return rows;
	}, [shareGroups]);

	const rowProps = useMemo<OrgShareHistoryRowProps>(
		() => ({
			rows: historyRows,
			currentShareId,
			onShareSelect: handleShareSelect,
		}),
		[historyRows, currentShareId, handleShareSelect],
	);

	const isHistoryHidden = sidebarState === "collapsed" && !isMobile;

	if (isUserLoading) {
		return <ChatSidebarSkeleton organization={null} isOrgLoading={true} />;
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
							<Badge>Chat</Badge>
						</Link>
						<div className="w-full rounded-md border p-4 text-sm">
							<div className="font-medium mb-2">Sign in required</div>
							<p className="text-muted-foreground mb-3">
								Please sign in to view organizations and shared chats.
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

	if (isSharesLoading || isOrgLoading) {
		return (
			<ChatSidebarSkeleton
				organization={selectedOrganization}
				isOrgLoading={isOrgLoading}
			/>
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
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							tooltip="New Chat"
							className="border border-border"
						>
							<Link href="/">
								<Plus className="h-4 w-4" />
								<span>New Chat</span>
							</Link>
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
					{organizations.length > 0 ? (
						<SidebarMenu className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
							<SidebarMenuItem>
								<OrganizationSwitcher
									organizations={organizations}
									selectedOrganization={selectedOrganization}
									onSelectOrganization={onSelectOrganization}
								/>
							</SidebarMenuItem>
						</SidebarMenu>
					) : null}
					<SidebarMenu className="px-2">
						<SidebarMenuItem>
							<SidebarMenuButton
								type="button"
								tooltip="Search Chats"
								onClick={() => setIsSearchOpen(true)}
							>
								<Search className="h-4 w-4" />
								<span>Search Chats</span>
								<kbd className="ml-auto text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 group-data-[collapsible=icon]:hidden">
									{isMac ? "⌘K" : "Alt+K"}
								</kbd>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</div>
				<div
					ref={listContainerRef}
					aria-hidden={isHistoryHidden}
					className="flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
				>
					{shares.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
							<MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
							<p className="text-sm text-muted-foreground mb-2">
								No shared chats
							</p>
							<p className="text-xs text-muted-foreground">
								Share a chat with this organization to see it here
							</p>
						</div>
					) : (
						<List
							className="min-h-0 w-full flex-1"
							style={{ width: "100%" }}
							rowComponent={OrgShareRowComponent}
							rowCount={historyRows.length}
							rowHeight={getOrgShareRowHeight}
							rowProps={rowProps}
							overscanCount={8}
						/>
					)}
				</div>
			</SidebarContent>

			<SidebarFooter>
				<div className="group-data-[collapsible=icon]:hidden">
					<CreditsDisplay
						organization={selectedOrganization}
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
			<OrgSearchDialog
				open={isSearchOpen}
				onOpenChange={setIsSearchOpen}
				organizationId={organizationId}
				onShareSelect={handleShareSelect}
			/>
		</Sidebar>
	);
}
