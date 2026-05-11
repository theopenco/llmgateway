"use client";

import { format } from "date-fns";
import { Plus, Loader2, MessageSquare, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { Chat } from "@/hooks/useChats";

const PAGE_SIZE = 50;
const ROW_HEIGHT_ACTION = 44;
const ROW_HEIGHT_HEADER = 38;
const ROW_HEIGHT_CHAT = 44;
const ROW_HEIGHT_EMPTY = 180;
const ROW_HEIGHT_LOADER = 48;

// How long to wait for the dialog close animation before navigating.
// Should match your Dialog's CSS exit animation duration.
const CLOSE_ANIMATION_MS = 150;

type SearchRow =
	| { type: "action"; key: string }
	| { type: "header"; key: string; title: string }
	| { type: "chat"; key: string; chat: Chat }
	| { type: "empty"; key: string; message: string }
	| { type: "loader"; key: string; message: string };

interface ChatSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNewChat?: () => void;
	onChatSelect?: (chatId: string) => void;
}

interface SearchRowProps {
	rows: SearchRow[];
	onNewChat: () => void;
	onChatSelect: (chatId: string) => void;
}

function useDebouncedValue(value: string, delay: number) {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const timeout = window.setTimeout(() => setDebouncedValue(value), delay);

		return () => window.clearTimeout(timeout);
	}, [delay, value]);

	return debouncedValue;
}

function formatDate(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

	if (diffInHours < 1) {
		return "Just now";
	}

	if (diffInHours < 24) {
		return `${Math.floor(diffInHours)}h ago`;
	}

	if (diffInHours < 48) {
		return "Yesterday";
	}

	return format(date, "MMM d");
}

// `now` is passed in so the caller controls the reference point,
// avoiding silent bugs if the component is rendered across midnight.
function groupChatsByDate(chats: Chat[], now: Date) {
	const today = new Date(now);
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(now);
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

function getSearchRowHeight(index: number, { rows }: SearchRowProps) {
	const row = rows[index];

	if (row?.type === "action") {
		return ROW_HEIGHT_ACTION;
	}

	if (row?.type === "header") {
		return ROW_HEIGHT_HEADER;
	}

	if (row?.type === "loader") {
		return ROW_HEIGHT_LOADER;
	}

	if (row?.type === "empty") {
		return ROW_HEIGHT_EMPTY;
	}

	return ROW_HEIGHT_CHAT;
}

function SearchRowComponent({
	ariaAttributes,
	index,
	style,
	rows,
	onNewChat,
	onChatSelect,
}: RowComponentProps<SearchRowProps>) {
	const row = rows[index];

	if (!row) {
		return null;
	}

	if (row.type === "action") {
		return (
			<div {...ariaAttributes} style={style}>
				<div className="px-2">
					<button
						type="button"
						onClick={onNewChat}
						className="flex h-11 w-full items-center gap-3 rounded-md px-4 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
					>
						<Plus className="size-4 shrink-0" />
						<span>New chat</span>
					</button>
				</div>
			</div>
		);
	}

	if (row.type === "header") {
		return (
			<div {...ariaAttributes} style={style}>
				<div className="flex h-full items-end px-6 pb-2 text-xs font-medium text-muted-foreground">
					{row.title}
				</div>
			</div>
		);
	}

	if (row.type === "loader") {
		return (
			<div {...ariaAttributes} style={style}>
				<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
					<Loader2 className="mr-2 size-4 animate-spin" />
					{row.message}
				</div>
			</div>
		);
	}

	if (row.type === "empty") {
		return (
			<div {...ariaAttributes} style={style}>
				<div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
					<MessageSquare className="mb-3 size-8 opacity-60" />
					{row.message}
				</div>
			</div>
		);
	}

	return (
		<div {...ariaAttributes} style={style}>
			<div className="px-4">
				<button
					type="button"
					onClick={() => onChatSelect(row.chat.id)}
					className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted/60"
				>
					<MessageSquare className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate font-medium">
						{row.chat.title}
					</span>
					<span className="shrink-0 text-xs text-muted-foreground">
						{formatDate(row.chat.updatedAt)}
					</span>
				</button>
			</div>
		</div>
	);
}

export function ChatSearchDialog({
	open,
	onOpenChange,
	onNewChat,
	onChatSelect,
}: ChatSearchDialogProps) {
	const api = useApi();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebouncedValue(query, 250);

	// Stable reference point for date grouping, captured when the dialog opens.
	// Prevents silent mis-grouping if the component renders across midnight.
	const nowRef = useRef<Date>(new Date());

	// Fix: reset query and refresh the date reference when the dialog opens/closes.
	useEffect(() => {
		if (open) {
			nowRef.current = new Date();
		} else {
			setQuery("");
		}
	}, [open]);

	const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } =
		api.useInfiniteQuery(
			"get",
			"/chats/search",
			{
				params: {
					query: {
						q: debouncedQuery,
						limit: PAGE_SIZE,
					},
				},
			},
			{
				enabled: open,
				initialPageParam: 0,
				pageParamName: "offset",
				refetchOnWindowFocus: false,
				getNextPageParam: (lastPage, pages) => {
					const loaded = pages.reduce(
						(total, page) => total + (page?.chats.length ?? 0),
						0,
					);

					return loaded < (lastPage?.total ?? 0) ? loaded : undefined;
				},
			},
		);

	useEffect(() => {
		if (!open) {
			return;
		}

		const timeout = window.setTimeout(() => inputRef.current?.focus(), 0);

		return () => window.clearTimeout(timeout);
	}, [open]);

	const chats = useMemo(
		() => data?.pages.flatMap((page) => page?.chats ?? []) ?? [],
		[data],
	);

	const rows = useMemo<SearchRow[]>(() => {
		const groups = groupChatsByDate(chats, nowRef.current);
		const nextRows: SearchRow[] = [];

		if (!debouncedQuery.trim()) {
			nextRows.push({ type: "action", key: "new-chat" });
		}

		[
			{ title: "Today", chats: groups.today },
			{ title: "Yesterday", chats: groups.yesterday },
			{ title: "Previous 7 Days", chats: groups.lastWeek },
			{ title: "Older", chats: groups.older },
		].forEach(({ title, chats: groupedChats }) => {
			if (groupedChats.length === 0) {
				return;
			}

			nextRows.push({ type: "header", key: `header-${title}`, title });
			groupedChats.forEach((chat) => {
				nextRows.push({ type: "chat", key: `chat-${chat.id}`, chat });
			});
		});

		if (isLoading) {
			nextRows.push({
				type: "loader",
				key: "loader",
				message: "Searching chats...",
			});
		} else if (chats.length === 0) {
			nextRows.push({
				type: "empty",
				key: "empty",
				message: debouncedQuery.trim() ? "No matching chats" : "No chats yet",
			});
		} else if (hasNextPage) {
			nextRows.push({
				type: "loader",
				key: "loader",
				message: "Loading more chats...",
			});
		}

		return nextRows;
	}, [chats, debouncedQuery, hasNextPage, isLoading]);

	// Fix: delay navigation until after the dialog close animation completes,
	// preventing the dialog from flashing back open during the route transition.
	// Applied to both handlers for consistency.
	const closeAndNewChat = useCallback(() => {
		onOpenChange(false);
		setTimeout(() => {
			onNewChat?.();
		}, CLOSE_ANIMATION_MS);
	}, [onNewChat, onOpenChange]);

	const closeAndSelectChat = useCallback(
		(chatId: string) => {
			onOpenChange(false);
			setTimeout(() => {
				onChatSelect?.(chatId);
			}, CLOSE_ANIMATION_MS);
		},
		[onChatSelect, onOpenChange],
	);

	const rowProps = useMemo<SearchRowProps>(
		() => ({
			rows,
			onNewChat: closeAndNewChat,
			onChatSelect: closeAndSelectChat,
		}),
		[closeAndNewChat, closeAndSelectChat, rows],
	);

	// Fix: use a ref latch to prevent duplicate fetchNextPage calls that could
	// occur if react-window fires onRowsRendered multiple times before the
	// previous fetch resolves.
	const isFetchingRef = useRef(false);

	useEffect(() => {
		if (!isFetchingNextPage) {
			isFetchingRef.current = false;
		}
	}, [isFetchingNextPage]);

	const handleRowsRendered = useCallback(
		({ stopIndex }: { startIndex: number; stopIndex: number }) => {
			if (
				hasNextPage &&
				!isLoading &&
				!isFetchingRef.current &&
				stopIndex >= rows.length - 4
			) {
				isFetchingRef.current = true;
				void fetchNextPage();
			}
		},
		[fetchNextPage, hasNextPage, isLoading, rows.length],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="grid h-[min(76vh,560px)] max-w-[min(720px,calc(100vw-2rem))] grid-rows-[4rem_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-border bg-popover p-0 text-popover-foreground"
			>
				<DialogTitle className="sr-only">Search chats</DialogTitle>
				<DialogDescription className="sr-only">
					Search through your past chats or start a new one.
				</DialogDescription>
				<div className="flex h-16 items-center gap-3 border-b px-6">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<Input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search chats..."
						className="h-full border-0 bg-transparent! px-0 text-base shadow-none focus-visible:ring-0"
					/>
					<button
						type="button"
						aria-label="Close search"
						onClick={() => onOpenChange(false)}
						className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X className="size-5" aria-hidden="true" />
					</button>
				</div>
				<div className="min-h-0 flex-1 py-2">
					<List
						className={cn("h-full min-h-0 w-full")}
						style={{ height: "100%", width: "100%" }}
						rowComponent={SearchRowComponent}
						rowCount={rows.length}
						rowHeight={getSearchRowHeight}
						rowProps={rowProps}
						overscanCount={8}
						onRowsRendered={handleRowsRendered}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
