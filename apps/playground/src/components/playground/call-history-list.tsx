"use client";

import { Edit2, MoreVerticalIcon, Phone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarMenuAction, SidebarMenuButton } from "@/components/ui/sidebar";
import {
	useDeleteRealtimeHistory,
	useUpdateRealtimeHistory,
} from "@/hooks/usePlaygroundHistory";
import { formatCallDuration } from "@/lib/call-history";

import { HistorySkeleton } from "./history-skeleton";

export interface CallHistoryItem {
	id: string;
	title: string;
	createdAt: string;
	model: string;
	voice: string | null;
	durationSeconds: number;
	turnCount: number;
}

interface CallHistoryListProps {
	items: CallHistoryItem[];
	isLoading?: boolean;
	currentItemId?: string | null;
	onItemClick: (itemId: string) => void;
	onItemDeleted?: (itemId: string) => void;
}

type CallHistoryRow =
	| { type: "header"; key: string; title: string }
	| { type: "item"; key: string; item: CallHistoryItem }
	| { type: "spacer"; key: string };

const ROW_HEIGHT_HEADER = 28;
const ROW_HEIGHT_SPACER = 6;
const ROW_HEIGHT_ITEM = 60;

interface CallHistoryRowProps {
	rows: CallHistoryRow[];
	currentItemId?: string | null;
	editingId: string | null;
	editTitle: string;
	pendingFocusId: string | null;
	onItemClick: (itemId: string) => void;
	onEditTitleChange: (value: string) => void;
	onSaveEdit: (id: string, original: string) => void;
	onCancelEdit: () => void;
	onDeleteItem: (id: string) => void;
	onStartEdit: (id: string, title: string) => void;
	onEditFocused: () => void;
}

function getCallHistoryRowHeight(
	index: number,
	{ rows }: CallHistoryRowProps,
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

function EditCallTitleInput({
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

function CallHistoryRowComponent({
	ariaAttributes,
	index,
	style,
	rows,
	currentItemId,
	editingId,
	editTitle,
	pendingFocusId,
	onItemClick,
	onEditTitleChange,
	onSaveEdit,
	onCancelEdit,
	onDeleteItem,
	onStartEdit,
	onEditFocused,
}: RowComponentProps<CallHistoryRowProps>) {
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

	return (
		<div {...ariaAttributes} style={style}>
			<div className="relative h-full px-2 pb-1">
				<div className="group/call-row relative h-full">
					{isEditing ? (
						<div className="flex h-full w-full items-center rounded-md px-2 pr-8 text-left text-sm ring-sidebar-ring bg-sidebar-accent text-sidebar-accent-foreground">
							<EditCallTitleInput
								itemId={item.id}
								value={editTitle}
								original={item.title}
								shouldFocus={pendingFocusId === item.id}
								onChange={onEditTitleChange}
								onSave={onSaveEdit}
								onCancel={onCancelEdit}
								onFocused={onEditFocused}
							/>
						</div>
					) : (
						<SidebarMenuButton
							onClick={() => onItemClick(item.id)}
							isActive={isActive}
							className="h-full! w-full justify-start group relative pr-2 !transition-none group-hover/call-row:pr-9"
							type="button"
						>
							<div className="flex items-start gap-2 min-w-0 w-full">
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border mt-0.5">
									<Phone className="h-4 w-4 text-muted-foreground" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="truncate text-sm font-medium mb-0.5">
										{item.title}
									</div>
									<div className="text-xs text-muted-foreground">
										{formatCallDuration(item.durationSeconds)} ·{" "}
										{new Date(item.createdAt).toLocaleTimeString([], {
											hour: "numeric",
											minute: "2-digit",
										})}
									</div>
								</div>
							</div>
						</SidebarMenuButton>
					)}
					{!isEditing && (
						<div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<SidebarMenuAction
										type="button"
										onClick={(e) => {
											e.stopPropagation();
										}}
										className="pointer-events-none static hidden h-7 w-7 cursor-pointer opacity-0 group-hover/call-row:flex group-hover/call-row:pointer-events-auto group-hover/call-row:opacity-100 data-[state=open]:flex data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
									>
										<MoreVerticalIcon className="h-3.5 w-3.5" />
									</SidebarMenuAction>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-40">
									<DropdownMenuItem
										onClick={(e) => {
											e.stopPropagation();
											onStartEdit(item.id, item.title);
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

function groupItemsByDate(items: CallHistoryItem[]) {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const lastWeek = new Date(today);
	lastWeek.setDate(lastWeek.getDate() - 7);

	const groups = {
		today: [] as CallHistoryItem[],
		yesterday: [] as CallHistoryItem[],
		lastWeek: [] as CallHistoryItem[],
		older: [] as CallHistoryItem[],
	};

	items.forEach((item) => {
		const itemDate = new Date(item.createdAt);
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

/**
 * Date-grouped list of past voice calls for the realtime sidebar, with inline
 * rename and delete. Mirrors the other studio history lists.
 */
export function CallHistoryList({
	items,
	isLoading = false,
	currentItemId,
	onItemClick,
	onItemDeleted,
}: CallHistoryListProps) {
	const renameItem = useUpdateRealtimeHistory();
	const deleteItem = useDeleteRealtimeHistory();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

	const startEdit = useCallback((id: string, title: string) => {
		setEditingId(id);
		setEditTitle(title);
		setPendingFocusId(id);
	}, []);

	const saveEdit = useCallback(
		(id: string, original: string) => {
			const next = editTitle.trim();
			if (next && next !== original) {
				renameItem.mutate({
					params: { path: { id } },
					body: { title: next },
				});
			}
			setEditingId(null);
			setEditTitle("");
			setPendingFocusId(null);
		},
		[editTitle, renameItem],
	);

	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setEditTitle("");
		setPendingFocusId(null);
	}, []);

	const handleDeleteItem = useCallback(
		(id: string) => {
			deleteItem.mutate(
				{ params: { path: { id } } },
				{ onSuccess: () => onItemDeleted?.(id) },
			);
		},
		[deleteItem, onItemDeleted],
	);

	const onEditFocused = useCallback(() => {
		setPendingFocusId(null);
	}, []);

	const itemGroups = useMemo(() => groupItemsByDate(items), [items]);

	const historyRows = useMemo<CallHistoryRow[]>(() => {
		const groups: Array<{ title: string; items: CallHistoryItem[] }> = [
			{ title: "Today", items: itemGroups.today },
			{ title: "Yesterday", items: itemGroups.yesterday },
			{ title: "Last 7 days", items: itemGroups.lastWeek },
			{ title: "Older", items: itemGroups.older },
		];
		const rows: CallHistoryRow[] = [];

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

	const rowProps = useMemo<CallHistoryRowProps>(
		() => ({
			rows: historyRows,
			currentItemId,
			editingId,
			editTitle,
			pendingFocusId,
			onItemClick,
			onEditTitleChange: setEditTitle,
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
			editTitle,
			pendingFocusId,
			onItemClick,
			saveEdit,
			cancelEdit,
			handleDeleteItem,
			startEdit,
			onEditFocused,
		],
	);

	if (isLoading && items.length === 0) {
		return <HistorySkeleton withThumbnail />;
	}

	if (items.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-center">
				<Phone className="h-12 w-12 text-muted-foreground/50 mb-4" />
				<p className="text-sm text-muted-foreground mb-2">No call history</p>
				<p className="text-xs text-muted-foreground">
					Finish a call to see its transcript here
				</p>
			</div>
		);
	}

	return (
		<List
			className="min-h-0 w-full flex-1"
			style={{ width: "100%" }}
			rowComponent={CallHistoryRowComponent}
			rowCount={historyRows.length}
			rowHeight={getCallHistoryRowHeight}
			rowProps={rowProps}
			overscanCount={8}
		/>
	);
}
