import Link from "next/link";
import { notFound } from "next/navigation";

import { ReadOnlyChatMessages } from "@/components/playground/chat-ui";
import { ForkChatButton } from "@/components/playground/fork-chat-button";
import { Logo } from "@/components/ui/logo";
import { getConfig } from "@/lib/config-server";
import { parsePlaygroundMessageMetadata } from "@/lib/message-metadata";

import type { UIMessage } from "ai";
import type { Metadata } from "next";

interface SharedMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	images: string | null;
	reasoning: string | null;
	tools: string | null;
	metadata?: unknown;
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

interface StoredImagePart {
	image_url?: {
		url?: string;
	};
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
	const { shareId } = await params;
	const config = getConfig();

	let title = "Shared Chat";
	let description =
		"A shared snapshot of an LLM Gateway chat — open it to see the full conversation.";

	try {
		const response = await fetch(
			`${config.apiBackendUrl}/public/chats/share/${shareId}`,
			{ cache: "no-store" },
		);
		if (response.ok) {
			const data = (await response.json()) as SharedChatResponse;
			const flatTitle = data.share.title?.replace(/\s+/g, " ").trim();
			if (flatTitle) {
				title =
					flatTitle.length > 80 ? `${flatTitle.slice(0, 80)}…` : flatTitle;
			}
			const userMessage = data.share.messages.find((m) => m.role === "user");
			const userText = userMessage?.content?.replace(/\s+/g, " ").trim();
			if (userText) {
				description =
					userText.length > 160 ? `${userText.slice(0, 160)}…` : userText;
			}
		}
	} catch {
		// Fall back to defaults if the API call fails.
	}

	const url = `/share/${shareId}`;

	return {
		title: `${title} · LLM Gateway`,
		description,
		alternates: {
			canonical: url,
		},
		openGraph: {
			title,
			description,
			url,
			type: "article",
			siteName: "LLM Gateway",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
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
				<div className="min-h-0 flex-1 pb-20">
					<ReadOnlyChatMessages messages={messages} />
				</div>
				<ForkChatButton shareId={data.share.id} />
			</div>
		</main>
	);
}

function toUiMessage(message: SharedMessage): UIMessage {
	const parts: UIMessage["parts"] = [];

	if (message.content) {
		parts.push({ type: "text", text: message.content });
	}

	if (message.reasoning) {
		parts.push({ type: "reasoning", text: message.reasoning });
	}

	if (message.images) {
		try {
			const parsedImages = JSON.parse(message.images) as unknown;
			if (Array.isArray(parsedImages)) {
				for (const image of parsedImages.filter(isStoredImagePart)) {
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
			}
		} catch {
			// Ignore malformed legacy image payloads in public snapshots.
		}
	}

	if (message.tools) {
		try {
			const parsedTools = JSON.parse(message.tools) as unknown;
			if (Array.isArray(parsedTools)) {
				parts.push(...parsedTools.filter(isToolUiPart));
			}
		} catch {
			// Ignore malformed legacy tool payloads in public snapshots.
		}
	}

	return {
		id: message.id,
		role: message.role,
		metadata: parsePlaygroundMessageMetadata(message.metadata),
		parts,
	} satisfies UIMessage;
}

function isStoredImagePart(value: unknown): value is StoredImagePart {
	return (
		typeof value === "object" &&
		value !== null &&
		(!("image_url" in value) ||
			value.image_url === undefined ||
			(typeof value.image_url === "object" &&
				value.image_url !== null &&
				(!("url" in value.image_url) ||
					value.image_url.url === undefined ||
					typeof value.image_url.url === "string")))
	);
}

function isToolUiPart(value: unknown): value is UIMessage["parts"][number] {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string" &&
		value.type.startsWith("tool-")
	);
}
