"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	Clock,
	Globe,
	Mail,
	MessageCircle,
	Monitor,
	Search,
	Send,
	User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useFetchClient } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

function timeAgo(dateString: string): string {
	const now = Date.now();
	const then = new Date(dateString).getTime();
	const diff = now - then;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) {
		return "just now";
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h`;
	}
	const days = Math.floor(hours / 24);
	if (days < 30) {
		return `${days}d`;
	}
	return new Date(dateString).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

function formatFullDate(dateString: string): string {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatMessageTime(dateString: string): string {
	return new Date(dateString).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function parseBrowser(userAgent: string): string {
	if (userAgent.includes("Firefox")) {
		return "Firefox";
	}
	if (userAgent.includes("Edg/")) {
		return "Edge";
	}
	if (userAgent.includes("Chrome")) {
		return "Chrome";
	}
	if (userAgent.includes("Safari")) {
		return "Safari";
	}
	if (userAgent.includes("Opera") || userAgent.includes("OPR")) {
		return "Opera";
	}
	return "Unknown";
}

function parseOS(userAgent: string): string {
	if (userAgent.includes("Windows")) {
		return "Windows";
	}
	if (userAgent.includes("Mac OS")) {
		return "macOS";
	}
	if (userAgent.includes("Linux")) {
		return "Linux";
	}
	if (userAgent.includes("Android")) {
		return "Android";
	}
	if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
		return "iOS";
	}
	return "Unknown";
}

function parseDevice(userAgent: string): string {
	const browser = parseBrowser(userAgent);
	const os = parseOS(userAgent);
	return `${browser} on ${os}`;
}

interface ConversationDetail {
	id: string;
	createdAt: string;
	updatedAt: string;
	name: string | null;
	email: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	messageCount: number;
	escalatedAt: string | null;
	messages: {
		id: string;
		createdAt: string;
		role: string;
		content: string;
		sequence: number;
	}[];
}

export function ChatSupportLogsClient() {
	const $fetch = useFetchClient();
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [replyText, setReplyText] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const replyInputRef = useRef<HTMLTextAreaElement>(null);

	const { data: readStatusData } = useQuery({
		queryKey: ["chat-support-read-statuses"],
		queryFn: async () => {
			const { data } = await $fetch.GET(
				"/admin/chat-support-logs/read-statuses",
			);
			return data?.readStatuses ?? {};
		},
	});

	const readMap = readStatusData ?? {};

	const markReadMutation = useMutation({
		mutationFn: async ({
			id,
			messageCount,
		}: {
			id: string;
			messageCount: number;
		}) => {
			await $fetch.POST("/admin/chat-support-logs/{id}/read", {
				params: { path: { id } },
				body: { messageCount },
			});
		},
		onSuccess: (_data, variables) => {
			queryClient.setQueryData<Record<string, number>>(
				["chat-support-read-statuses"],
				(old) => ({
					...old,
					[variables.id]: variables.messageCount,
				}),
			);
		},
	});

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(timer);
	}, [search]);

	const { data: listData, isLoading: listLoading } = useQuery({
		queryKey: ["chat-support-logs", debouncedSearch],
		queryFn: async () => {
			const { data } = await $fetch.GET("/admin/chat-support-logs", {
				params: {
					query: {
						limit: 100,
						offset: 0,
						search: debouncedSearch || undefined,
					},
				},
			});
			return data ?? { conversations: [], total: 0 };
		},
	});

	const conversations = listData?.conversations ?? [];

	const { data: detail, isLoading: detailLoading } = useQuery({
		queryKey: ["chat-support-log", selectedId],
		queryFn: async () => {
			if (!selectedId) {
				return null;
			}
			const { data } = await $fetch.GET("/admin/chat-support-logs/{id}", {
				params: { path: { id: selectedId } },
			});
			return (data as ConversationDetail | undefined) ?? null;
		},
		enabled: !!selectedId,
	});

	const replyMutation = useMutation({
		mutationFn: async ({ id, content }: { id: string; content: string }) => {
			const { data } = await $fetch.POST(
				"/admin/chat-support-logs/{id}/reply",
				{
					params: { path: { id } },
					body: { content },
				},
			);
			return data;
		},
		onSuccess: () => {
			setReplyText("");
			void queryClient.invalidateQueries({
				queryKey: ["chat-support-log", selectedId],
			});
			void queryClient.invalidateQueries({
				queryKey: ["chat-support-logs"],
			});
		},
	});

	useEffect(() => {
		if (detail?.messages && selectedId) {
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
			markReadMutation.mutate({
				id: selectedId,
				messageCount: detail.messages.length,
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- markReadMutation.mutate is stable from useMutation
	}, [detail?.messages, selectedId]);

	const handleSelectConversation = useCallback(
		(id: string) => {
			setSelectedId(id);
			setReplyText("");
			const conv = conversations.find((c) => c.id === id);
			if (conv) {
				markReadMutation.mutate({ id, messageCount: conv.messageCount });
			}
		},
		[conversations, markReadMutation.mutate],
	);

	const handleReplySubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = replyText.trim();
		if (!trimmed || !selectedId || replyMutation.isPending) {
			return;
		}
		replyMutation.mutate({ id: selectedId, content: trimmed });
	};

	const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleReplySubmit(e);
		}
	};

	const selectedConv = conversations.find((c) => c.id === selectedId);

	return (
		<div className="flex h-[calc(100vh-3.5rem)] overflow-hidden md:h-screen">
			{/* Left panel — Conversation list */}
			<div
				className={cn(
					"flex shrink-0 flex-col border-r border-border/60 bg-card",
					selectedId ? "hidden md:flex md:w-80" : "w-full md:w-80",
				)}
			>
				{/* Search header */}
				<div className="border-b border-border/60 px-4 py-3">
					<h2 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
						Conversations
					</h2>
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search messages..."
							className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>
				</div>

				{/* Conversation list */}
				<ScrollArea className="flex-1">
					{listLoading ? (
						<div className="flex flex-col gap-1 p-2">
							{Array.from({ length: 8 }).map((_, i) => (
								<div
									key={`skeleton-${i}`}
									className="flex flex-col gap-2 rounded-lg px-3 py-3"
								>
									<div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
									<div className="h-3 w-full animate-pulse rounded bg-muted" />
								</div>
							))}
						</div>
					) : conversations.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-2 px-4 py-12">
							<MessageCircle className="h-8 w-8 text-muted-foreground/40" />
							<p className="text-xs text-muted-foreground">
								No conversations found
							</p>
						</div>
					) : (
						<div className="flex flex-col gap-0.5 p-1.5">
							{conversations.map((conv) => (
								<button
									key={conv.id}
									type="button"
									onClick={() => handleSelectConversation(conv.id)}
									className={cn(
										"group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
										selectedId === conv.id
											? "bg-primary/8 ring-1 ring-primary/20"
											: "hover:bg-muted/60",
									)}
								>
									<div className="relative">
										<div
											className={cn(
												"mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
												selectedId === conv.id
													? "bg-primary text-primary-foreground"
													: "bg-muted text-muted-foreground",
											)}
										>
											{conv.name
												? conv.name
														.split(" ")
														.map((w) => w[0])
														.join("")
														.slice(0, 2)
														.toUpperCase()
												: "?"}
										</div>
										{conv.escalatedAt && (
											<span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-amber-500">
												<AlertTriangle className="h-2 w-2 text-white" />
											</span>
										)}
										{(readMap[conv.id] ?? 0) < conv.messageCount && (
											<span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
										)}
									</div>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<div className="flex items-center justify-between gap-2">
											<span
												className={cn(
													"truncate text-sm font-medium",
													selectedId === conv.id
														? "text-primary"
														: "text-foreground",
												)}
											>
												{conv.name ?? "Anonymous"}
											</span>
											<span className="shrink-0 text-[11px] text-muted-foreground">
												{timeAgo(conv.createdAt)}
											</span>
										</div>
										<p className="truncate text-xs text-muted-foreground">
											{conv.firstMessage ?? "No messages yet"}
										</p>
									</div>
								</button>
							))}
						</div>
					)}
				</ScrollArea>

				{/* Footer count */}
				<div className="border-t border-border/60 px-4 py-2">
					<p className="text-[11px] text-muted-foreground">
						{listData?.total ?? 0} total conversations
					</p>
				</div>
			</div>

			{/* Middle panel — Chat thread */}
			<div
				className={cn(
					"flex min-w-0 flex-1 flex-col overflow-hidden bg-background",
					!selectedId && "hidden md:flex",
				)}
			>
				{!selectedId ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
						<MessageCircle className="h-12 w-12 opacity-20" />
						<p className="text-sm">Select a conversation to view</p>
					</div>
				) : detailLoading ? (
					<div className="flex flex-1 flex-col gap-4 p-6">
						{Array.from({ length: 5 }).map((_, i) => (
							<div
								key={`msg-skeleton-${i}`}
								className={cn(
									"flex",
									i % 2 === 0 ? "justify-start" : "justify-end",
								)}
							>
								<div
									className={cn(
										"animate-pulse rounded-2xl bg-muted",
										i % 2 === 0 ? "h-16 w-64" : "h-10 w-48",
									)}
								/>
							</div>
						))}
					</div>
				) : detail ? (
					<>
						{/* Chat header */}
						<div className="flex items-center gap-3 border-b border-border/60 px-6 py-3">
							<button
								type="button"
								onClick={() => setSelectedId(null)}
								className="mr-1 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted md:hidden"
							>
								<ArrowLeft className="h-4 w-4" />
							</button>
							<div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
								{detail.name
									? detail.name
											.split(" ")
											.map((w) => w[0])
											.join("")
											.slice(0, 2)
											.toUpperCase()
									: "?"}
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-foreground">
									{detail.name ?? "Anonymous"}
								</p>
								<p className="text-xs text-muted-foreground">
									{detail.messageCount} messages
								</p>
							</div>
							{detail.escalatedAt && (
								<div className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
									<AlertTriangle className="h-3 w-3" />
									<span className="text-xs font-medium">Escalated</span>
								</div>
							)}
						</div>

						{/* Messages */}
						<ScrollArea className="min-h-0 flex-1">
							<div className="flex flex-col gap-4 px-6 py-4">
								{detail.messages.map((message) => {
									const isUser = message.role === "user";
									const isAdmin = message.role === "admin";
									const isAssistant = message.role === "assistant";
									return (
										<div
											key={message.id}
											className={cn(
												"flex",
												isAdmin ? "justify-end" : "justify-start",
											)}
										>
											<div className="flex max-w-[70%] flex-col gap-1">
												{isAdmin && (
													<span className="pr-1 text-right text-[11px] font-medium text-blue-600 dark:text-blue-400">
														Admin
													</span>
												)}
												{isUser && (
													<span className="pl-1 text-[11px] font-medium text-muted-foreground">
														Visitor
													</span>
												)}
												{isAssistant && (
													<span className="pl-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
														Bot
													</span>
												)}
												<div
													className={cn(
														"rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
														isAssistant &&
															"rounded-bl-md bg-muted/70 text-foreground",
														isUser && "rounded-bl-md bg-muted text-foreground",
														isAdmin &&
															"rounded-br-md bg-blue-600 text-white dark:bg-blue-700",
													)}
												>
													<p className="whitespace-pre-wrap">
														{message.content}
													</p>
												</div>
												<span
													className={cn(
														"text-[11px] text-muted-foreground",
														isAdmin ? "pr-1 text-right" : "pl-1",
													)}
												>
													{formatMessageTime(message.createdAt)}
												</span>
											</div>
										</div>
									);
								})}
								{detail.messages.length === 0 && (
									<div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
										<p className="text-sm">No messages in this conversation</p>
									</div>
								)}
								<div ref={messagesEndRef} />
							</div>
						</ScrollArea>

						{/* Reply input */}
						<div className="border-t border-border/60 px-4 py-3">
							<form
								onSubmit={handleReplySubmit}
								className="flex items-end gap-2"
							>
								<textarea
									ref={replyInputRef}
									value={replyText}
									onChange={(e) => setReplyText(e.target.value)}
									onKeyDown={handleReplyKeyDown}
									placeholder={
										detail.email
											? "Reply (will also be sent via email)..."
											: "Reply..."
									}
									rows={1}
									className="field-sizing-content max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
								/>
								<button
									type="submit"
									disabled={!replyText.trim() || replyMutation.isPending}
									className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
								>
									<Send className="h-4 w-4" />
									<span className="sr-only">Send reply</span>
								</button>
							</form>
							{replyMutation.isError && (
								<p className="mt-1.5 text-xs text-destructive">
									Failed to send reply. Please try again.
								</p>
							)}
						</div>
					</>
				) : null}
			</div>

			{/* Right panel — User details */}
			<div className="hidden w-72 shrink-0 flex-col border-l border-border/60 bg-card xl:flex">
				{(selectedConv ?? detail) ? (
					<>
						{/* User profile header */}
						<div className="flex flex-col items-center gap-3 border-b border-border/60 px-6 py-6">
							<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
								{(detail?.name ?? selectedConv?.name)
									? (detail?.name ?? selectedConv?.name ?? "")
											.split(" ")
											.map((w) => w[0])
											.join("")
											.slice(0, 2)
											.toUpperCase()
									: "?"}
							</div>
							<div className="text-center">
								<p className="text-sm font-semibold text-foreground">
									{detail?.name ?? selectedConv?.name ?? "Anonymous"}
								</p>
								{(detail?.email ?? selectedConv?.email) && (
									<p className="mt-0.5 text-xs text-muted-foreground">
										{detail?.email ?? selectedConv?.email}
									</p>
								)}
							</div>
						</div>

						{/* Details sections */}
						<ScrollArea className="flex-1">
							<div className="flex flex-col gap-0.5 p-4">
								{/* Escalation status */}
								{(detail?.escalatedAt ?? selectedConv?.escalatedAt) && (
									<div className="mb-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
										<div className="flex items-center gap-2">
											<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
											<span className="text-xs font-semibold text-amber-800 dark:text-amber-400">
												Escalated
											</span>
										</div>
										<p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
											{formatFullDate(
												detail?.escalatedAt ?? selectedConv?.escalatedAt ?? "",
											)}
										</p>
									</div>
								)}

								{/* Main information */}
								<div className="mb-2">
									<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										Contact Details
									</h3>
									<div className="flex flex-col gap-3">
										<div className="flex items-start gap-3">
											<User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="text-xs font-medium text-muted-foreground">
													Name
												</p>
												<p className="text-sm text-foreground">
													{detail?.name ?? selectedConv?.name ?? "Not provided"}
												</p>
											</div>
										</div>
										<div className="flex items-start gap-3">
											<Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="text-xs font-medium text-muted-foreground">
													Email
												</p>
												<p className="break-all text-sm text-foreground">
													{detail?.email ??
														selectedConv?.email ??
														"Not provided"}
												</p>
											</div>
										</div>
									</div>
								</div>

								<div className="my-2 h-px bg-border/60" />

								{/* Session information */}
								<div className="mb-2">
									<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										Session Info
									</h3>
									<div className="flex flex-col gap-3">
										<div className="flex items-start gap-3">
											<Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="text-xs font-medium text-muted-foreground">
													Started
												</p>
												<p className="text-sm text-foreground">
													{formatFullDate(
														detail?.createdAt ?? selectedConv?.createdAt ?? "",
													)}
												</p>
											</div>
										</div>
										<div className="flex items-start gap-3">
											<MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="text-xs font-medium text-muted-foreground">
													Messages
												</p>
												<p className="text-sm text-foreground">
													{detail?.messageCount ??
														selectedConv?.messageCount ??
														0}
												</p>
											</div>
										</div>
									</div>
								</div>

								<div className="my-2 h-px bg-border/60" />

								{/* Visitor device */}
								<div className="mb-2">
									<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										Visitor Device
									</h3>
									<div className="flex flex-col gap-3">
										{(detail?.userAgent ?? selectedConv?.userAgent) && (
											<div className="flex items-start gap-3">
												<Monitor className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
												<div className="min-w-0">
													<p className="text-xs font-medium text-muted-foreground">
														Device
													</p>
													<p className="text-sm text-foreground">
														{parseDevice(
															detail?.userAgent ??
																selectedConv?.userAgent ??
																"",
														)}
													</p>
												</div>
											</div>
										)}
										<div className="flex items-start gap-3">
											<Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="text-xs font-medium text-muted-foreground">
													IP Address
												</p>
												<p className="text-sm text-foreground">
													{detail?.ipAddress ??
														selectedConv?.ipAddress ??
														"Unknown"}
												</p>
											</div>
										</div>
									</div>
								</div>
							</div>
						</ScrollArea>
					</>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-muted-foreground">
						<User className="h-8 w-8 opacity-20" />
						<p className="text-center text-xs">
							Select a conversation to view visitor details
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
