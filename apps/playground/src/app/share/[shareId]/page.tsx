import Link from "next/link";
import { notFound } from "next/navigation";

import { ReadOnlyChatMessages } from "@/components/playground/chat-ui";
import { Logo } from "@/components/ui/logo";
import { getConfig } from "@/lib/config-server";

import type { UIMessage } from "ai";
import type { Metadata } from "next";

interface SharedMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	images: string | null;
	reasoning: string | null;
	tools: string | null;
	sequence: number;
	createdAt: string;
}

interface SharedChatResponse {
	share: {
		id: string;
		title: string;
		model: string;
		createdAt: string;
		messages: SharedMessage[];
	};
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
	const { shareId } = await params;

	return {
		title: "Shared Chat - LLM Gateway",
		alternates: {
			canonical: `/share/${shareId}`,
		},
	};
}

export default async function SharedChatPage({
	params,
}: {
	params: Promise<{ shareId: string }>;
}) {
	const { shareId } = await params;
	const config = getConfig();
	const response = await fetch(
		`${config.apiBackendUrl}/public/chats/share/${shareId}`,
		{
			cache: "no-store",
		},
	);

	if (!response.ok) {
		notFound();
	}

	const data = (await response.json()) as SharedChatResponse;
	const messages = data.share.messages.map(toUiMessage);

	return (
		<main className="bg-background min-h-screen">
			<div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-8">
				<header className="mx-auto w-full max-w-4xl pb-4">
					<Link href="/" className="flex w-fit items-center gap-2">
						<Logo className="size-6" />
						<span className="text-lg font-semibold">LLM Gateway</span>
					</Link>
					<h1 className="mt-8 text-3xl font-semibold tracking-normal">
						{data.share.title}
					</h1>
					<div className="text-muted-foreground mt-3 flex flex-wrap gap-x-2 gap-y-1 text-sm">
						<span>
							Published{" "}
							{new Intl.DateTimeFormat("en", {
								dateStyle: "medium",
								timeStyle: "short",
							}).format(new Date(data.share.createdAt))}
						</span>
					</div>
				</header>
				<div className="min-h-0 flex-1">
					<ReadOnlyChatMessages messages={messages} />
				</div>
			</div>
		</main>
	);
}

function toUiMessage(message: SharedMessage): UIMessage {
	const parts: any[] = [];

	if (message.content) {
		parts.push({ type: "text", text: message.content });
	}

	if (message.reasoning) {
		parts.push({ type: "reasoning", text: message.reasoning });
	}

	if (message.images) {
		try {
			const parsedImages = JSON.parse(message.images) as Array<{
				image_url?: { url?: string };
			}>;
			for (const image of parsedImages) {
				const dataUrl = image.image_url?.url ?? "";
				if (dataUrl.startsWith("data:")) {
					const [header, base64] = dataUrl.split(",");
					const mediaType = header.match(/data:([^;]+)/)?.[1] ?? "image/png";
					parts.push({
						type: "file",
						mediaType,
						url: base64,
					});
				} else {
					parts.push({
						type: "file",
						mediaType: "image/png",
						url: dataUrl,
					});
				}
			}
		} catch {
			// Ignore malformed legacy image payloads in public snapshots.
		}
	}

	if (message.tools) {
		try {
			const parsedTools = JSON.parse(message.tools) as any[];
			if (Array.isArray(parsedTools)) {
				parts.push(...parsedTools);
			}
		} catch {
			// Ignore malformed legacy tool payloads in public snapshots.
		}
	}

	return {
		id: message.id,
		role: message.role,
		content: message.content ?? "",
		parts,
	} as UIMessage;
}
