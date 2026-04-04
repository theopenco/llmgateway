"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { MessageCircle, X, Send, RotateCcw, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

import type { UIMessage } from "ai";

function getTextFromParts(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");
}

function MarkdownContent({ content }: { content: string }) {
	const parts = content.split(
		/(https?:\/\/docs\.llmgateway\.io[^\s),]*|\*\*[^*]+\*\*|`[^`]+`|\n)/g,
	);

	return (
		<>
			{parts.map((part) => {
				if (!part) {
					return null;
				}
				if (part === "\n") {
					return <br key={part} />;
				}
				if (part.startsWith("https://docs.llmgateway.io")) {
					const path = part.replace("https://docs.llmgateway.io", "");
					const label =
						path.replace(/^\//, "").replace(/[-_/]/g, " ") || "docs";
					return (
						<a
							key={part}
							href={part}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
						>
							{label}
							<ExternalLink className="size-3" />
						</a>
					);
				}
				if (part.startsWith("**") && part.endsWith("**")) {
					return (
						<strong key={part} className="font-semibold">
							{part.slice(2, -2)}
						</strong>
					);
				}
				if (part.startsWith("`") && part.endsWith("`")) {
					return (
						<code
							key={part}
							className="rounded bg-muted px-1 py-0.5 text-xs font-mono"
						>
							{part.slice(1, -1)}
						</code>
					);
				}
				return part;
			})}
		</>
	);
}

export function ChatSupport() {
	const config = useAppConfig();
	const [isOpen, setIsOpen] = useState(false);
	const [hasUnread, setHasUnread] = useState(false);
	const [text, setText] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const prevMessageCountRef = useRef(0);

	const chat = useMemo(
		() =>
			new Chat({
				transport: new TextStreamChatTransport({
					api: `${config.apiUrl}/public/chat-support`,
				}),
			}),
		[config.apiUrl],
	);

	const { messages, sendMessage, status, setMessages } = useChat({ chat });

	const isLoading = status === "streaming" || status === "submitted";

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isOpen]);

	// Show unread indicator when assistant responds while chat is closed
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
	});

	const handleOpen = () => {
		setIsOpen(true);
		setHasUnread(false);
	};

	const handleReset = () => {
		setMessages([]);
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
			{/* Chat window */}
			<div
				className={cn(
					"fixed bottom-20 right-4 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl transition-all duration-300 ease-out sm:right-6",
					isOpen
						? "h-[min(32rem,calc(100vh-7rem))] w-[min(24rem,calc(100vw-2rem))] scale-100 opacity-100"
						: "pointer-events-none h-0 w-0 scale-95 opacity-0",
				)}
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-border bg-primary px-4 py-3">
					<div className="flex items-center gap-2">
						<div className="flex size-7 items-center justify-center rounded-full bg-primary-foreground/20">
							<MessageCircle className="size-3.5 text-primary-foreground" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-primary-foreground">
								Support
							</h3>
							<p className="text-[10px] text-primary-foreground/70">
								AI-powered help
							</p>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={handleReset}
							className="rounded-md p-1.5 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
							aria-label="Reset conversation"
						>
							<RotateCcw className="size-3.5" />
						</button>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="rounded-md p-1.5 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
							aria-label="Close chat"
						>
							<X className="size-3.5" />
						</button>
					</div>
				</div>

				{/* Messages */}
				<div className="flex-1 overflow-y-auto px-4 py-3">
					<div className="flex flex-col gap-3">
						{messages.length === 0 && (
							<div className="flex justify-start">
								<div className="max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
									Hi! I&apos;m the LLM Gateway support assistant. How can I help
									you today?
								</div>
							</div>
						)}
						{messages.map((message) => {
							const content = getTextFromParts(message);
							if (!content) {
								return null;
							}
							return (
								<div
									key={message.id}
									className={cn(
										"flex",
										message.role === "user" ? "justify-end" : "justify-start",
									)}
								>
									<div
										className={cn(
											"max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
											message.role === "user"
												? "bg-primary text-primary-foreground"
												: "bg-muted text-foreground",
										)}
									>
										{message.role === "assistant" ? (
											<MarkdownContent content={content} />
										) : (
											content
										)}
									</div>
								</div>
							);
						})}
						{isLoading &&
							(messages.length === 0 ||
								messages[messages.length - 1]?.role !== "assistant") && (
								<div className="flex justify-start">
									<div className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2">
										<div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
										<div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
										<div className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
									</div>
								</div>
							)}
						<div ref={messagesEndRef} />
					</div>
				</div>

				{/* Input */}
				<div className="border-t border-border p-3">
					<form onSubmit={handleSubmit} className="flex items-end gap-2">
						<textarea
							ref={inputRef}
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask about LLM Gateway..."
							rows={1}
							className="field-sizing-content max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
						/>
						<Button
							type="submit"
							size="icon"
							disabled={!text.trim() || isLoading}
							className="size-9 shrink-0 rounded-lg"
						>
							<Send className="size-4" />
							<span className="sr-only">Send message</span>
						</Button>
					</form>
				</div>
			</div>

			{/* Floating trigger button */}
			<button
				type="button"
				onClick={isOpen ? () => setIsOpen(false) : handleOpen}
				className={cn(
					"fixed bottom-4 right-4 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:bg-primary/90 hover:shadow-xl active:scale-95 sm:right-6",
					isOpen && "rotate-90",
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
