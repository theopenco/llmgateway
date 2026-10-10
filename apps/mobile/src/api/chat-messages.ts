import { z } from "zod";

import { readSources } from "@/api/sources";
import { readToolParts } from "@/api/tool-parts";

import type { Message } from "@/api/completion";
import type { Source } from "@/api/sources";
import type { ToolPart } from "@/api/tool-parts";
import type { paths } from "@/lib/api/v1";

type ChatResponse =
	paths["/chats/{id}"]["get"]["responses"][200]["content"]["application/json"];
type StoredMessage = ChatResponse["messages"][number];
export type ChatMessage = StoredMessage & {
	attachments: Attachment[];
	sourceLinks: Source[];
	toolParts?: ToolPart[];
};
export interface Attachment {
	id: string;
	name: string;
	mediaType: string;
	url: string;
}
const imagesSchema = z.array(
	z.object({ image_url: z.object({ url: z.string() }) }),
);
const filesSchema = z.array(
	z.object({
		url: z.string(),
		mediaType: z.string(),
		name: z.string().optional(),
	}),
);

export function readChat(data: ChatResponse) {
	return { ...data, messages: data.messages.map(readChatMessage) };
}

export function readChatMessage(message: StoredMessage): ChatMessage {
	const attachments: Attachment[] = [];
	try {
		if (message.images) {
			for (const [index, image] of imagesSchema
				.parse(JSON.parse(message.images))
				.entries()) {
				const mediaType =
					image.image_url.url.match(/^data:([^;]+);/)?.[1] ?? "image/png";
				const extension =
					mediaType === "image/jpeg"
						? "jpg"
						: mediaType === "image/webp"
							? "webp"
							: "png";
				attachments.push({
					id: `${message.id}-image-${index}`,
					name: `Image ${index + 1}.${extension}`,
					mediaType,
					url: image.image_url.url,
				});
			}
		}
		for (const [kind, raw] of [
			["audio", message.audios],
			["document", message.documents],
		] as const) {
			if (raw) {
				for (const [index, file] of filesSchema
					.parse(JSON.parse(raw))
					.entries()) {
					attachments.push({
						...file,
						id: `${message.id}-${kind}-${index}`,
						name: file.name ?? `${kind} ${index + 1}`,
					});
				}
			}
		}
	} catch (cause) {
		throw new Error(
			"A saved attachment could not be read. Please reload this conversation.",
			{ cause },
		);
	}
	return {
		...message,
		attachments,
		sourceLinks: readSources(message.sources),
		toolParts: readToolParts(message.tools),
	};
}

export function storedAttachments(attachments: Attachment[]) {
	const images = attachments.filter((item) =>
		item.mediaType.startsWith("image/"),
	);
	const audio = attachments.filter((item) =>
		item.mediaType.startsWith("audio/"),
	);
	const documents = attachments.filter(
		(item) =>
			!item.mediaType.startsWith("image/") &&
			!item.mediaType.startsWith("audio/"),
	);
	return {
		...(images.length && {
			images: JSON.stringify(
				images.map((item) => ({
					type: "image_url",
					image_url: { url: item.url },
				})),
			),
		}),
		...(audio.length && {
			audios: JSON.stringify(
				audio.map((item) => ({
					type: "audio",
					url: item.url,
					mediaType: item.mediaType,
					name: item.name,
				})),
			),
		}),
		...(documents.length && {
			documents: JSON.stringify(
				documents.map((item) => ({
					type: "file",
					url: item.url,
					mediaType: item.mediaType,
					name: item.name,
				})),
			),
		}),
	};
}

const audioFormats = {
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/mp4": "m4a",
	"audio/x-m4a": "m4a",
	"audio/aac": "aac",
	"audio/ogg": "ogg",
	"audio/flac": "flac",
	"audio/webm": "webm",
	"audio/aiff": "aiff",
} as const;

export function completionMessage(
	role: Message["role"],
	content: string,
	attachments: Attachment[] = [],
): Message {
	if (!attachments.length) {
		return { role, content };
	}
	return {
		role,
		content: [
			...(content ? [{ type: "text" as const, text: content }] : []),
			...attachments.map((item) => {
				if (item.mediaType.startsWith("image/")) {
					return { type: "image_url" as const, image_url: { url: item.url } };
				}
				if (item.mediaType.startsWith("audio/")) {
					if (!(item.mediaType in audioFormats) || /^https?:/i.test(item.url)) {
						throw new Error(
							`Attach ${item.name} again as a supported audio file.`,
						);
					}
					return {
						type: "input_audio" as const,
						input_audio: {
							data: item.url.replace(/^data:[^,]+,/, ""),
							format: audioFormats[item.mediaType as keyof typeof audioFormats],
						},
					};
				}
				return {
					type: "file" as const,
					file: { filename: item.name, file_data: item.url },
				};
			}),
		],
	};
}
