"use client";

import { format } from "date-fns";
import { Loader2, MessageSquare, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useOrgShares } from "@/hooks/useChats";
import { cn } from "@/lib/utils";

const ROW_HEIGHT_HEADER = 38;
const ROW_HEIGHT_SHARE = 44;
const ROW_HEIGHT_EMPTY = 180;
const ROW_HEIGHT_LOADER = 48;

const CLOSE_ANIMATION_MS = 150;

interface OrgShareItem {
	id: string;
	title: string;
	model: string;
	createdAt: string;
	updatedAt: string;
}

type SearchRow =
	| { type: "header"; key: string; title: string }
	| { type: "share"; key: string; share: OrgShareItem }
	| { type: "empty"; key: string; message: string }
	| { type: "loader"; key: string; message: string };

interface OrgSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onShareSelect?: (shareId: string) => void;
	organizationId: string;
}

interface SearchRowProps {
	rows: SearchRow[];
	onShareSelect: (shareId: string) => void;
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

function groupSharesByDate(shares: OrgShareItem[], now: Date) {
	const today = new Date(now);
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(now);
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

function getSearchRowHeight(index: number, { rows }: SearchRowProps) {
	const row = rows[index];
	if (row?.type === "header") {
		return ROW_HEIGHT_HEADER;
	}
	if (row?.type === "loader") {
		return ROW_HEIGHT_LOADER;
	}
	if (row?.type === "empty") {
		return ROW_HEIGHT_EMPTY;
	}
	return ROW_HEIGHT_SHARE;
}

function SearchRowComponent({
	ariaAttributes,
	index,
	style,
	rows,
	onShareSelect,
}: RowComponentProps<SearchRowProps>) {
	const row = rows[index];

	if (!row) {
		return null;
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
					onClick={() => onShareSelect(row.share.id)}
					className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted/60"
				>
					<MessageSquare className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate font-medium">
						{row.share.title}
					</span>
					<span className="shrink-0 text-xs text-muted-foreground">
						{formatDate(row.share.updatedAt)}
					</span>
				</button>
			</div>
		</div>
	);
}

export function OrgSearchDialog({
	open,
	onOpenChange,
	onShareSelect,
	organizationId,
}: OrgSearchDialogProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebouncedValue(query, 250);
	const nowRef = useRef<Date>(new Date());

	const { data: orgSharesData, isLoading } = useOrgShares(organizationId);

	useEffect(() => {
		if (open) {
			nowRef.current = new Date();
		} else {
			setQuery("");
		}
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const timeout = window.setTimeout(() => inputRef.current?.focus(), 0);
		return () => window.clearTimeout(timeout);
	}, [open]);

	const shares = useMemo<OrgShareItem[]>(() => {
		const all = orgSharesData?.shares ?? [];
		const q = debouncedQuery.trim().toLowerCase();
		return q ? all.filter((s) => s.title.toLowerCase().includes(q)) : all;
	}, [orgSharesData?.shares, debouncedQuery]);

	const rows = useMemo<SearchRow[]>(() => {
		const groups = groupSharesByDate(shares, nowRef.current);
		const nextRows: SearchRow[] = [];

		[
			{ title: "Today", shares: groups.today },
			{ title: "Yesterday", shares: groups.yesterday },
			{ title: "Previous 7 Days", shares: groups.lastWeek },
			{ title: "Older", shares: groups.older },
		].forEach(({ title, shares: groupedShares }) => {
			if (groupedShares.length === 0) {
				return;
			}
			nextRows.push({ type: "header", key: `header-${title}`, title });
			groupedShares.forEach((share) => {
				nextRows.push({ type: "share", key: `share-${share.id}`, share });
			});
		});

		if (isLoading) {
			nextRows.push({
				type: "loader",
				key: "loader",
				message: "Loading shared chats...",
			});
		} else if (shares.length === 0) {
			nextRows.push({
				type: "empty",
				key: "empty",
				message: debouncedQuery.trim()
					? "No matching chats"
					: "No shared chats in this organization",
			});
		}

		return nextRows;
	}, [shares, debouncedQuery, isLoading]);

	const closeAndSelectShare = useCallback(
		(shareId: string) => {
			onOpenChange(false);
			setTimeout(() => {
				onShareSelect?.(shareId);
			}, CLOSE_ANIMATION_MS);
		},
		[onShareSelect, onOpenChange],
	);

	const rowProps = useMemo<SearchRowProps>(
		() => ({
			rows,
			onShareSelect: closeAndSelectShare,
		}),
		[closeAndSelectShare, rows],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="grid h-[min(76vh,560px)] max-w-[min(720px,calc(100vw-2rem))] grid-rows-[4rem_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border-border bg-popover p-0 text-popover-foreground"
			>
				<DialogTitle className="sr-only">Search organization chats</DialogTitle>
				<DialogDescription className="sr-only">
					Search through shared chats in this organization.
				</DialogDescription>
				<div className="flex h-16 items-center gap-3 border-b px-6">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<Input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search shared chats..."
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
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
