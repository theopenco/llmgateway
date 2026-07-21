"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { createCodePlugin } from "@streamdown/code";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import {
	MessageCircle,
	X,
	Send,
	RotateCcw,
	UserRound,
	Loader2,
	ThumbsUp,
	ThumbsDown,
	Star,
	CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { useSessionStatus, useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { useFetchClient } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { UIMessage } from "ai";
import type { LinkSafetyConfig } from "streamdown";

const code = createCodePlugin({
	themes: ["github-light", "github-dark"],
});

const linkSafety: LinkSafetyConfig = {
	enabled: true,
	onLinkCheck: (url: string) => {
		try {
			const hostname = new URL(url).hostname;
			return (
				hostname === "llmgateway.io" || hostname.endsWith(".llmgateway.io")
			);
		} catch {
			return false;
		}
	},
};

const ESCALATION_THRESHOLD = 3;

const CLIENT_ID_KEY = "chat_support_client_id";
const PRIVACY_DISMISSED_KEY = "chat_support_privacy_dismissed";

// Client-side anti-spam guard. The backend is authoritative (see
// public-chat-support.ts), but blocking rapid-fire sends here gives instant
// feedback and avoids burning the server quota on obvious spam.
const CLIENT_RATE_MAX = 5;
const CLIENT_RATE_WINDOW_MS = 20_000;

const SUGGESTED_QUESTIONS = [
	"How do I get started with LLM Gateway?",
	"Which models and providers are supported?",
	"How does pricing and billing work?",
];

// Phrases that signal the visitor wants a human rather than the AI assistant.
const HUMAN_REQUEST_PATTERN =
	/\b(?:human|real|live)\s+(?:operator|person|agent|help|support|being|rep(?:resentative)?)\b|\b(?:talk|speak|connect|chat)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|someone|agent|operator|rep(?:resentative)?|support|staff)\b|\b(?:need|want|get|reach)\s+(?:a\s+)?(?:human|real\s+person|live\s+agent|person)\b|\bhuman\s+operator\b/i;

function wantsHuman(text: string): boolean {
	return HUMAN_REQUEST_PATTERN.test(text);
}

interface ConversationMessage {
	id: string;
	role: "user" | "assistant" | "admin";
	content: string;
	sequence: number;
	reaction: "like" | "dislike" | null;
}

interface ConversationData {
	conversationId: string | null;
	messages: ConversationMessage[];
	resolvedAt: string | null;
	rating: number | null;
	escalatedAt: string | null;
}

interface MessageMeta {
	sequence?: number;
	admin?: boolean;
}

// Persisted in localStorage so a visitor's conversation survives reloads and
// new sessions — that's what lets them keep seeing admin replies over time.
function getOrCreateClientId(): string {
	if (typeof window === "undefined") {
		return "";
	}
	const existing = localStorage.getItem(CLIENT_ID_KEY);
	if (existing) {
		return existing;
	}
	const id = crypto.randomUUID();
	localStorage.setItem(CLIENT_ID_KEY, id);
	return id;
}

function getTextFromParts(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");
}

export function ChatSupport() {
	const fetchClient = useFetchClient();
	const queryClient = useQueryClient();
	const { isAuthenticated } = useSessionStatus();
	const { user } = useUser({ enabled: isAuthenticated });
	const [isOpen, setIsOpen] = useState(false);
	const [hasUnread, setHasUnread] = useState(false);
	const [text, setText] = useState("");
	const [userName, setUserName] = useState("");
	const [userEmail, setUserEmail] = useState("");
	const [hasIdentified, setHasIdentified] = useState(false);
	const [escalated, setEscalated] = useState(false);
	const [showRating, setShowRating] = useState(false);
	const [hoverRating, setHoverRating] = useState(0);
	const [reactionOverrides, setReactionOverrides] = useState<
		Record<number, "like" | "dislike">
	>({});
	const [privacyDismissed, setPrivacyDismissed] = useState(false);
	const [rateLimitNotice, setRateLimitNotice] = useState<string | null>(null);
	const lastUserMessageRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const prevMessageCountRef = useRef(0);
	const prevUserCountRef = useRef(0);
	const prevAdminCountRef = useRef(0);
	const sendTimestampsRef = useRef<number[]>([]);
	const [clientId, setClientId] = useState("");
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setClientId(getOrCreateClientId());
		setMounted(true);
		if (typeof window !== "undefined") {
			setPrivacyDismissed(
				localStorage.getItem(PRIVACY_DISMISSED_KEY) === "true",
			);
		}
	}, []);

	const isLoggedIn = mounted && !!user;
	const effectiveName = isLoggedIn ? (user?.name ?? "") : userName;
	const effectiveEmail = isLoggedIn ? (user?.email ?? "") : userEmail;

	const conversationQueryKey = useMemo(
		() => ["chat-support-conversation", clientId],
		[clientId],
	);

	const { data: convData } = useQuery<ConversationData>({
		queryKey: conversationQueryKey,
		enabled: !!clientId && isOpen,
		refetchInterval: isOpen ? 8000 : false,
		queryFn: async () => {
			const res = await fetchClient.GET(
				"/public/chat-support/conversation" as never,
				{ params: { query: { clientId } } } as never,
			);
			if (res.error) {
				throw new Error("Failed to load conversation");
			}
			return res.data as unknown as ConversationData;
		},
	});

	const chat = useMemo(
		() =>
			new Chat({
				transport: new DefaultChatTransport({
					api: "/api/chat-support",
					body: {
						name: effectiveName,
						email: effectiveEmail,
						clientId,
					},
				}),
			}),
		[effectiveName, effectiveEmail, clientId],
	);

	const { messages, sendMessage, status, setMessages, error } = useChat({
		chat,
		onFinish: () => {
			void queryClient.invalidateQueries({ queryKey: conversationQueryKey });
		},
	});

	const isLoading = status === "streaming" || status === "submitted";

	// Adopt the persisted server history when it has content the client doesn't
	// yet show — initial restore on open and admin replies that arrive via poll.
	useEffect(() => {
		if (!convData || status !== "ready") {
			return;
		}
		const serverMessages = convData.messages;
		if (serverMessages.length === 0) {
			return;
		}
		// Re-seed from the server when it holds messages the client isn't showing
		// (admin replies arriving via poll) or when the local copy hasn't yet been
		// reconciled to carry server sequence metadata — required for reactions.
		const allSeeded = messages.every(
			(m) => (m.metadata as MessageMeta | undefined)?.sequence !== undefined,
		);
		if (
			serverMessages.length > messages.length ||
			(serverMessages.length === messages.length && !allSeeded)
		) {
			setMessages(
				serverMessages.map((m) => ({
					id: `srv-${m.sequence}`,
					role: m.role === "user" ? "user" : "assistant",
					parts: [{ type: "text", text: m.content }],
					metadata: { sequence: m.sequence, admin: m.role === "admin" },
				})),
			);
		}
	}, [convData, status, messages, setMessages]);

	useEffect(() => {
		if (convData?.escalatedAt) {
			setEscalated(true);
		}
	}, [convData?.escalatedAt]);

	const reactionBySequence = useMemo(() => {
		const map: Record<number, "like" | "dislike"> = {};
		for (const m of convData?.messages ?? []) {
			if (m.role === "assistant" && m.reaction) {
				map[m.sequence] = m.reaction;
			}
		}
		return map;
	}, [convData?.messages]);

	const isResolved = !!convData?.resolvedAt;
	const hasConversation = (convData?.messages.length ?? 0) > 0;
	const isIdentified = isLoggedIn || hasIdentified || hasConversation;

	// Reposition only on discrete new turns — never on streaming tokens, so the
	// view stays fixed while the assistant types and the visitor reads at their
	// own pace. When the visitor sends, anchor their question to the top so the
	// answer fills in below (top-to-bottom). When a human (admin) reply arrives
	// via the poll, bring it into view since it's the newest message.
	useEffect(() => {
		const userCount = messages.filter((m) => m.role === "user").length;
		const adminCount = messages.filter(
			(m) => (m.metadata as MessageMeta | undefined)?.admin === true,
		).length;
		if (userCount > prevUserCountRef.current) {
			lastUserMessageRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
		} else if (adminCount > prevAdminCountRef.current) {
			messagesEndRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "end",
			});
		}
		prevUserCountRef.current = userCount;
		prevAdminCountRef.current = adminCount;
	}, [messages]);

	useEffect(() => {
		if (!rateLimitNotice) {
			return;
		}
		const id = setTimeout(() => setRateLimitNotice(null), 4000);
		return () => clearTimeout(id);
	}, [rateLimitNotice]);

	useEffect(() => {
		if (isOpen && isIdentified && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isOpen, isIdentified]);

	useEffect(() => {
		if (
			!isOpen &&
			messages.length > prevMessageCountRef.current &&
			messages.length > 0
		) {
			const lastMessage = messages[messages.length - 1];
			if (lastMessage?.role === "assistant") {
				setHasUnread(true);
			}
		}
		prevMessageCountRef.current = messages.length;
	}, [isOpen, messages]);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		if (!isOpen) {
			return;
		}
		// Only lock scroll on mobile where the widget becomes a full-screen sheet.
		const mq = window.matchMedia("(max-width: 639px)");
		if (!mq.matches) {
			return;
		}
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [isOpen]);

	const handleOpen = () => {
		setIsOpen(true);
		setHasUnread(false);
	};

	const userMessageCount = messages.filter((m) => m.role === "user").length;
	const lastUserIndex = messages.reduce(
		(acc, m, i) => (m.role === "user" ? i : acc),
		-1,
	);
	const showSuggestions = messages.length === 0 && !escalated && !isResolved;
	const requestedHuman = useMemo(
		() =>
			messages.some(
				(m) => m.role === "user" && wantsHuman(getTextFromParts(m)),
			),
		[messages],
	);
	const showEscalation =
		!escalated && (userMessageCount >= ESCALATION_THRESHOLD || requestedHuman);
	const canResolve = !isResolved && userMessageCount >= 1;

	const escalateMutation = useMutation({
		mutationFn: async () => {
			const res = await fetchClient.POST(
				"/public/chat-support/escalate" as never,
				{
					body: {
						name: effectiveName,
						email: effectiveEmail,
						clientId,
						messages: messages.map((m) => ({
							role: m.role,
							content: getTextFromParts(m),
						})),
					},
				} as never,
			);
			if (res.error) {
				throw new Error("Escalation failed");
			}
			return res.data;
		},
		onSuccess: () => {
			setEscalated(true);
		},
	});

	const reactionMutation = useMutation({
		mutationFn: async (vars: {
			sequence: number;
			reaction: "like" | "dislike" | null;
		}) => {
			const res = await fetchClient.POST(
				"/public/chat-support/reaction" as never,
				{ body: { clientId, ...vars } } as never,
			);
			if (res.error) {
				throw new Error("Reaction failed");
			}
			return res.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: conversationQueryKey });
		},
	});

	const resolveMutation = useMutation({
		mutationFn: async (rating: number) => {
			const res = await fetchClient.POST(
				"/public/chat-support/resolve" as never,
				{ body: { clientId, rating } } as never,
			);
			if (res.error) {
				throw new Error("Resolve failed");
			}
			return res.data;
		},
		onSuccess: () => {
			setShowRating(false);
			void queryClient.invalidateQueries({ queryKey: conversationQueryKey });
		},
	});

	const handleReact = (sequence: number, reaction: "like" | "dislike") => {
		const current = reactionOverrides[sequence] ?? reactionBySequence[sequence];
		const next = current === reaction ? null : reaction;
		setReactionOverrides((prev) => {
			const updated: Record<number, "like" | "dislike"> = {};
			for (const [key, value] of Object.entries(prev)) {
				if (Number(key) !== sequence) {
					updated[Number(key)] = value;
				}
			}
			if (next) {
				updated[sequence] = next;
			}
			return updated;
		});
		reactionMutation.mutate({ sequence, reaction: next });
	};

	const handleReset = () => {
		setMessages([]);
		setEscalated(false);
		setShowRating(false);
		setReactionOverrides({});
		// Rotate the client id so the next message opens a brand-new conversation.
		// The previous one stays persisted for the support team to review.
		const newId = crypto.randomUUID();
		if (typeof window !== "undefined") {
			localStorage.setItem(CLIENT_ID_KEY, newId);
		}
		setClientId(newId);
		if (!isLoggedIn) {
			setHasIdentified(false);
			setUserName("");
			setUserEmail("");
		}
	};

	const handleIdentify = (e: React.FormEvent) => {
		e.preventDefault();
		if (!userName.trim()) {
			return;
		}
		setHasIdentified(true);
	};

	const handleDismissPrivacy = () => {
		setPrivacyDismissed(true);
		if (typeof window !== "undefined") {
			localStorage.setItem(PRIVACY_DISMISSED_KEY, "true");
		}
	};

	// Returns false (and surfaces a notice) when the visitor is sending too fast.
	const canSend = (): boolean => {
		const now = Date.now();
		const recent = sendTimestampsRef.current.filter(
			(t) => now - t < CLIENT_RATE_WINDOW_MS,
		);
		if (recent.length >= CLIENT_RATE_MAX) {
			setRateLimitNotice(
				"You're sending messages too quickly. Please wait a few seconds.",
			);
			return false;
		}
		recent.push(now);
		sendTimestampsRef.current = recent;
		setRateLimitNotice(null);
		return true;
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = text.trim();
		if (!trimmed || isLoading) {
			return;
		}
		if (!canSend()) {
			return;
		}
		void sendMessage({ text: trimmed });
		setText("");
	};

	const handleSuggestion = (question: string) => {
		if (isLoading) {
			return;
		}
		if (!canSend()) {
			return;
		}
		void sendMessage({ text: question });
		setText("");
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	};

	return (
		<>
			<div
				aria-hidden={!isOpen}
				inert={!isOpen}
				className={cn(
					"fixed z-[60] flex flex-col overflow-hidden border-border bg-background shadow-2xl transition-all duration-200 ease-out",
					"inset-0 rounded-none border-0",
					"sm:inset-auto sm:bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:right-6 sm:h-[min(42rem,calc(100svh-6rem))] sm:w-[28rem] sm:rounded-xl sm:border",
					isOpen
						? "visible translate-y-0 opacity-100"
						: "invisible pointer-events-none translate-y-4 opacity-0",
				)}
			>
				<div
					className="flex shrink-0 items-center justify-between border-b border-border bg-primary px-4 py-3"
					style={{
						paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)",
					}}
				>
					<div className="flex items-center gap-2.5">
						<div className="flex size-8 items-center justify-center rounded-full bg-primary-foreground/20">
							<MessageCircle className="size-4 text-primary-foreground" />
						</div>
						<div className="leading-tight">
							<h3 className="text-sm font-semibold text-primary-foreground">
								Support
							</h3>
							<p className="text-xs text-primary-foreground/70">
								AI-powered help
							</p>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={handleReset}
							className="flex size-9 items-center justify-center rounded-md text-primary-foreground/80 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
							aria-label="Start a new conversation"
							title="Start a new conversation"
							style={{ touchAction: "manipulation" }}
						>
							<RotateCcw className="size-4" />
						</button>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="flex size-9 items-center justify-center rounded-md text-primary-foreground/80 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
							aria-label="Close chat"
							style={{ touchAction: "manipulation" }}
						>
							<X className="size-4" />
						</button>
					</div>
				</div>

				{!isIdentified ? (
					<div className="flex flex-1 flex-col justify-center px-6 py-8">
						<div className="mb-6 text-center">
							<h4 className="text-base font-semibold text-foreground">
								Welcome!
							</h4>
							<p className="mt-1 text-sm text-muted-foreground">
								Please introduce yourself before we start.
							</p>
						</div>
						<form onSubmit={handleIdentify} className="flex flex-col gap-3">
							<input
								type="text"
								value={userName}
								onChange={(e) => setUserName(e.target.value)}
								placeholder="Your name *"
								required
								className="rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring sm:text-sm"
								autoFocus
							/>
							<input
								type="email"
								value={userEmail}
								onChange={(e) => setUserEmail(e.target.value)}
								placeholder="Your email (optional)"
								className="rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring sm:text-sm"
							/>
							<Button
								type="submit"
								disabled={!userName.trim()}
								className="mt-1 w-full"
							>
								Start Chat
							</Button>
						</form>
					</div>
				) : (
					<>
						<div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
							<div className="flex flex-col gap-3">
								{messages.length === 0 && (
									<div className="flex justify-start">
										<div className="max-w-[85%] rounded-2xl bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
											Hi{effectiveName ? ` ${effectiveName}` : ""}! I&apos;m the
											LLM Gateway support assistant. How can I help you today?
										</div>
									</div>
								)}
								{messages.map((message, index) => {
									const content = getTextFromParts(message);
									if (!content) {
										return null;
									}
									const meta = (message.metadata ?? {}) as MessageMeta;
									const isAdmin = meta.admin === true;
									const isAssistant = message.role === "assistant" && !isAdmin;
									const sequence = meta.sequence ?? index;
									const isPersisted = meta.sequence !== undefined;
									const reaction =
										reactionOverrides[sequence] ?? reactionBySequence[sequence];
									const isLastAssistant =
										isAssistant &&
										message.id === messages[messages.length - 1]?.id;
									return (
										<div
											key={message.id}
											ref={
												index === lastUserIndex ? lastUserMessageRef : undefined
											}
											className={cn(
												"flex scroll-mt-2 flex-col gap-1",
												message.role === "user" ? "items-end" : "items-start",
											)}
										>
											{isAdmin && (
												<span className="px-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
													Support team
												</span>
											)}
											<div
												className={cn(
													"max-w-[85%] overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words",
													isAdmin
														? "bg-blue-600 text-white dark:bg-blue-700"
														: isAssistant
															? "bg-muted text-foreground"
															: "bg-primary text-primary-foreground",
												)}
											>
												{isAssistant ? (
													<Streamdown
														isAnimating={isLastAssistant && isLoading}
														controls={false}
														plugins={{ code }}
														linkSafety={linkSafety}
														className="overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all [&_ul]:pl-5 [&_ol]:pl-5"
													>
														{content}
													</Streamdown>
												) : (
													content
												)}
											</div>
											{isAssistant && isPersisted && (
												<div className="flex items-center gap-1 px-1">
													<button
														type="button"
														onClick={() => handleReact(sequence, "like")}
														aria-label="Helpful"
														className={cn(
															"flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted",
															reaction === "like"
																? "text-emerald-600 dark:text-emerald-400"
																: "text-muted-foreground",
														)}
														style={{ touchAction: "manipulation" }}
													>
														<ThumbsUp className="size-3.5" />
													</button>
													<button
														type="button"
														onClick={() => handleReact(sequence, "dislike")}
														aria-label="Not helpful"
														className={cn(
															"flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted",
															reaction === "dislike"
																? "text-rose-600 dark:text-rose-400"
																: "text-muted-foreground",
														)}
														style={{ touchAction: "manipulation" }}
													>
														<ThumbsDown className="size-3.5" />
													</button>
												</div>
											)}
										</div>
									);
								})}
								{isLoading &&
									(messages.length === 0 ||
										messages[messages.length - 1]?.role !== "assistant" ||
										!getTextFromParts(messages[messages.length - 1]!)) && (
										<div className="flex justify-start">
											<div className="flex items-center gap-1.5 rounded-2xl bg-muted px-3.5 py-3">
												<div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
												<div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
												<div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
											</div>
										</div>
									)}
								{error && (
									<div className="flex justify-start">
										<div className="max-w-[85%] rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-sm leading-relaxed text-destructive">
											<p>Something went wrong. Please try again.</p>
											{error.message && (
												<p className="mt-1 text-xs opacity-80 break-words">
													{error.message}
												</p>
											)}
										</div>
									</div>
								)}
								<div ref={messagesEndRef} />
							</div>
						</div>

						{showSuggestions && (
							<div className="flex shrink-0 flex-col items-end gap-2 px-4 pb-1">
								{SUGGESTED_QUESTIONS.map((question) => (
									<button
										key={question}
										type="button"
										onClick={() => handleSuggestion(question)}
										disabled={isLoading}
										className="max-w-[90%] rounded-2xl border border-border bg-background px-3.5 py-2 text-right text-sm leading-relaxed text-foreground transition-colors hover:bg-muted disabled:opacity-50"
										style={{ touchAction: "manipulation" }}
									>
										{question}
									</button>
								))}
							</div>
						)}

						{isResolved ? (
							<div className="shrink-0 border-t border-border bg-emerald-50 px-4 py-2.5 dark:bg-emerald-950/30">
								<div className="flex items-center gap-1.5">
									<CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
									<p className="text-xs text-emerald-700 dark:text-emerald-400">
										Conversation resolved. Thanks for your feedback!
									</p>
								</div>
								{(convData?.rating ?? 0) > 0 && (
									<div className="mt-1 flex items-center gap-0.5">
										{Array.from({ length: 5 }).map((_, i) => (
											<Star
												key={i}
												className={cn(
													"size-3.5",
													i < (convData.rating ?? 0)
														? "fill-amber-400 text-amber-400"
														: "fill-none text-muted-foreground/40",
												)}
											/>
										))}
									</div>
								)}
							</div>
						) : showRating ? (
							<div className="shrink-0 border-t border-border bg-muted/50 px-4 py-3">
								<p className="mb-2 text-xs text-muted-foreground">
									How would you rate this conversation?
								</p>
								<div className="flex items-center gap-1">
									{Array.from({ length: 5 }).map((_, i) => {
										const value = i + 1;
										return (
											<button
												key={value}
												type="button"
												onMouseEnter={() => setHoverRating(value)}
												onMouseLeave={() => setHoverRating(0)}
												onClick={() => resolveMutation.mutate(value)}
												disabled={resolveMutation.isPending}
												aria-label={`${value} star${value > 1 ? "s" : ""}`}
												className="flex size-8 items-center justify-center"
												style={{ touchAction: "manipulation" }}
											>
												<Star
													className={cn(
														"size-6 transition-colors",
														value <= hoverRating
															? "fill-amber-400 text-amber-400"
															: "fill-none text-muted-foreground/50",
													)}
												/>
											</button>
										);
									})}
								</div>
								<button
									type="button"
									onClick={() => resolveMutation.mutate(0)}
									disabled={resolveMutation.isPending}
									className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
								>
									Resolve without rating
								</button>
							</div>
						) : (
							(showEscalation || canResolve) && (
								<div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-4 py-2.5">
									{showEscalation && (
										<button
											type="button"
											onClick={() => escalateMutation.mutate()}
											disabled={escalateMutation.isPending}
											className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
											style={{ touchAction: "manipulation" }}
										>
											{escalateMutation.isPending ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<UserRound className="size-3.5" />
											)}
											Talk to a human
										</button>
									)}
									{canResolve && (
										<button
											type="button"
											onClick={() => setShowRating(true)}
											className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
											style={{ touchAction: "manipulation" }}
										>
											<CheckCircle2 className="size-3.5" />
											Resolve
										</button>
									)}
								</div>
							)
						)}
						{escalated && !isResolved && (
							<div className="shrink-0 border-t border-border bg-green-50 px-4 py-2.5 dark:bg-green-950/30">
								<p className="text-xs text-green-700 dark:text-green-400">
									We&apos;ve notified our team. We&apos;ll reply here and via
									email shortly.
								</p>
							</div>
						)}

						{!privacyDismissed && (
							<div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/50 px-4 py-2">
								<p className="text-xs text-muted-foreground">
									By chatting, you agree to our{" "}
									<Link
										href="/legal/privacy"
										target="_blank"
										className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
									>
										privacy policy
									</Link>
									.
								</p>
								<button
									type="button"
									onClick={handleDismissPrivacy}
									aria-label="Dismiss privacy notice"
									className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									style={{ touchAction: "manipulation" }}
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						<div
							className="shrink-0 border-t border-border bg-background p-3"
							style={{
								paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.75rem)",
							}}
						>
							{rateLimitNotice && (
								<p className="mb-2 px-1 text-xs text-amber-600 dark:text-amber-400">
									{rateLimitNotice}
								</p>
							)}
							<form onSubmit={handleSubmit} className="flex items-end gap-2">
								<textarea
									ref={inputRef}
									value={text}
									onChange={(e) => setText(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder={
										escalated
											? "Message the support team..."
											: "Ask about LLM Gateway..."
									}
									rows={1}
									className="field-sizing-content max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring sm:text-sm"
								/>
								<Button
									type="submit"
									size="icon"
									disabled={!text.trim() || isLoading}
									className="size-10 shrink-0 rounded-lg"
								>
									<Send className="size-4" />
									<span className="sr-only">Send message</span>
								</Button>
							</form>
						</div>
					</>
				)}
			</div>

			<button
				type="button"
				onClick={isOpen ? () => setIsOpen(false) : handleOpen}
				style={{
					bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
					right: "calc(1rem + env(safe-area-inset-right, 0px))",
					touchAction: "manipulation",
				}}
				className={cn(
					"fixed z-[70] flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 hover:shadow-xl active:scale-95 sm:!right-6 sm:flex",
					isOpen && "rotate-90",
					isOpen && "hidden sm:flex",
				)}
				aria-label={isOpen ? "Close chat" : "Open chat support"}
			>
				{isOpen ? (
					<X className="size-5" />
				) : (
					<>
						<MessageCircle className="size-5" />
						{hasUnread && (
							<span className="absolute -right-0.5 -top-0.5 flex size-3">
								<span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
								<span className="relative inline-flex size-3 rounded-full bg-destructive" />
							</span>
						)}
					</>
				)}
			</button>
		</>
	);
}
