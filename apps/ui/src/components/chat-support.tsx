"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { createCodePlugin } from "@streamdown/code";
import { useMutation } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import {
	MessageCircle,
	X,
	Send,
	RotateCcw,
	UserRound,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { useUser } from "@/hooks/useUser";
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

function getOrCreateClientId(): string {
	if (typeof window === "undefined") {
		return "";
	}
	const existing = sessionStorage.getItem(CLIENT_ID_KEY);
	if (existing) {
		return existing;
	}
	const id = crypto.randomUUID();
	sessionStorage.setItem(CLIENT_ID_KEY, id);
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
	const { user } = useUser();
	const [isOpen, setIsOpen] = useState(false);
	const [hasUnread, setHasUnread] = useState(false);
	const [text, setText] = useState("");
	const [userName, setUserName] = useState("");
	const [userEmail, setUserEmail] = useState("");
	const [hasIdentified, setHasIdentified] = useState(false);
	const [escalated, setEscalated] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const prevMessageCountRef = useRef(0);
	const [clientId] = useState(() => getOrCreateClientId());

	const isLoggedIn = !!user;
	const effectiveName = isLoggedIn ? (user.name ?? "") : userName;
	const effectiveEmail = isLoggedIn ? (user.email ?? "") : userEmail;
	const isIdentified = isLoggedIn || hasIdentified;

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
	});

	const isLoading = status === "streaming" || status === "submitted";

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

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
	const showEscalation = !escalated && userMessageCount >= ESCALATION_THRESHOLD;

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

	const handleReset = () => {
		setMessages([]);
		setEscalated(false);
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

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = text.trim();
		if (!trimmed || isLoading) {
			return;
		}
		void sendMessage({ text: trimmed });
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
					"sm:inset-auto sm:bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:right-6 sm:h-[min(32rem,calc(100svh-7rem))] sm:w-[24rem] sm:rounded-xl sm:border",
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
							aria-label="Reset conversation"
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
								{messages.map((message) => {
									const content = getTextFromParts(message);
									if (!content) {
										return null;
									}
									const isAssistant = message.role === "assistant";
									const isLastAssistant =
										isAssistant &&
										message.id === messages[messages.length - 1]?.id;
									return (
										<div
											key={message.id}
											className={cn(
												"flex",
												isAssistant ? "justify-start" : "justify-end",
											)}
										>
											<div
												className={cn(
													"max-w-[85%] overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words",
													isAssistant
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
														className="overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all"
													>
														{content}
													</Streamdown>
												) : (
													content
												)}
											</div>
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

						{showEscalation && (
							<div className="shrink-0 border-t border-border bg-muted/50 px-4 py-2.5">
								<p className="mb-1.5 text-xs text-muted-foreground">
									Still need help?
								</p>
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
							</div>
						)}
						{escalated && (
							<div className="shrink-0 border-t border-border bg-green-50 px-4 py-2.5 dark:bg-green-950/30">
								<p className="text-xs text-green-700 dark:text-green-400">
									We&apos;ve notified our team. We&apos;ll get back to you via
									email shortly.
								</p>
							</div>
						)}

						<div
							className="shrink-0 border-t border-border bg-background p-3"
							style={{
								paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.75rem)",
							}}
						>
							<form onSubmit={handleSubmit} className="flex items-end gap-2">
								<textarea
									ref={inputRef}
									value={text}
									onChange={(e) => setText(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="Ask about LLM Gateway..."
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
