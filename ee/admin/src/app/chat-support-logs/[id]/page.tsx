import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";
import { cn } from "@/lib/utils";

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatTime(dateString: string) {
	return new Date(dateString).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export default async function ChatSupportLogDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireSession();

	const { id } = await params;
	const $api = await createServerApiClient();
	const { data, response } = await $api.GET("/admin/chat-support-logs/{id}", {
		params: { path: { id } },
	});

	if (!data || "error" in data) {
		const isNotFound = response.status === 404;
		return (
			<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
				<Link
					href="/chat-support-logs"
					className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to chat logs
				</Link>
				<p className="text-muted-foreground">
					{isNotFound
						? "Conversation not found."
						: "Failed to load conversation. Please try again later."}
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<Link
				href="/chat-support-logs"
				className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to chat logs
			</Link>

			<header className="flex flex-col gap-2">
				<h1 className="text-3xl font-semibold tracking-tight">Conversation</h1>
				<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
					<span>Started {formatDate(data.createdAt)}</span>
					<span>{data.messageCount} messages</span>
					{data.ipAddress && <span>IP: {data.ipAddress}</span>}
				</div>
			</header>

			{data.userAgent && (
				<div className="rounded-lg border border-border/60 bg-card px-4 py-3">
					<p className="text-xs text-muted-foreground break-all">
						<span className="font-medium">User Agent:</span> {data.userAgent}
					</p>
				</div>
			)}

			<div className="rounded-lg border border-border/60 bg-card">
				<div className="flex flex-col divide-y divide-border/60">
					{data.messages.map((message) => {
						const isAssistant = message.role === "assistant";
						return (
							<div key={message.id} className="flex gap-4 px-6 py-4">
								<div
									className={cn(
										"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
										isAssistant
											? "bg-primary/10 text-primary"
											: "bg-muted text-muted-foreground",
									)}
								>
									{isAssistant ? "AI" : "U"}
								</div>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium">
											{isAssistant ? "Assistant" : "User"}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatTime(message.createdAt)}
										</span>
									</div>
									<p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
										{message.content}
									</p>
								</div>
							</div>
						);
					})}
					{data.messages.length === 0 && (
						<div className="px-6 py-12 text-center text-muted-foreground">
							No messages in this conversation
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
