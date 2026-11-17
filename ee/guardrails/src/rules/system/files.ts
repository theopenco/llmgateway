import type { Message } from "@/types.js";

/** Extensions an allowed-types entry may name instead of a MIME type. */
const EXTENSION_MIME_TYPES: Record<string, string[]> = {
	jpg: ["image/jpeg"],
	jpeg: ["image/jpeg"],
	png: ["image/png"],
	gif: ["image/gif"],
	webp: ["image/webp"],
	heic: ["image/heic"],
	pdf: ["application/pdf"],
	txt: ["text/plain"],
	md: ["text/markdown", "text/x-markdown"],
	csv: ["text/csv"],
	json: ["application/json"],
	xml: ["application/xml", "text/xml"],
	html: ["text/html"],
	doc: ["application/msword"],
	docx: [
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	],
	xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
	pptx: [
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	],
	mp3: ["audio/mpeg", "audio/mp3"],
	wav: ["audio/wav", "audio/x-wav"],
	m4a: ["audio/mp4", "audio/m4a"],
	ogg: ["audio/ogg"],
	flac: ["audio/flac"],
	webm: ["audio/webm", "video/webm"],
	mp4: ["video/mp4", "audio/mp4"],
};

const AUDIO_FORMAT_MIME_TYPES: Record<string, string> = {
	mp3: "audio/mpeg",
	mpeg: "audio/mpeg",
	mpga: "audio/mpeg",
	wav: "audio/wav",
	aac: "audio/aac",
	aiff: "audio/aiff",
	flac: "audio/flac",
	m4a: "audio/mp4",
	mp4: "audio/mp4",
	ogg: "audio/ogg",
	pcm: "audio/pcm",
	webm: "audio/webm",
};

const DATA_URI = /^data:([^;,]+)(?:;[^,]*)?,/i;
const TEXT_DATA_URI = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+=*)/g;

export interface FileLimits {
	/** MIME types (`image/png`, `image/*`) or extensions (`pdf`). Empty allows every type. */
	allowedFileTypes: string[];
	maxFileSizeMb: number;
}

interface FileCandidate {
	mimeType: string | null;
	/** Decoded size; null for remote URLs, whose size is unknown. */
	bytes: number | null;
}

export function isFileTypeAllowed(
	mimeType: string,
	allowedFileTypes: string[],
): boolean {
	if (allowedFileTypes.length === 0) {
		return true;
	}
	const mime = mimeType.toLowerCase();
	return allowedFileTypes.some((entry) => {
		const allowed = entry.trim().toLowerCase().replace(/^\./, "");
		if (allowed.includes("/")) {
			return allowed.endsWith("/*")
				? mime.startsWith(allowed.slice(0, -1))
				: mime === allowed;
		}
		return EXTENSION_MIME_TYPES[allowed]?.includes(mime) ?? false;
	});
}

function base64Bytes(data: string): number {
	const length = data.replace(/\s/g, "").length;
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((length * 3) / 4) - padding);
}

function mimeFromName(name: string | undefined): string | null {
	const extension = name?.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
	if (!extension || extension === name) {
		return null;
	}
	return EXTENSION_MIME_TYPES[extension]?.[0] ?? null;
}

function fromDataUri(uri: string): FileCandidate {
	const match = DATA_URI.exec(uri);
	return {
		mimeType: match?.[1] ?? null,
		bytes: base64Bytes(uri.slice(uri.indexOf(",") + 1)),
	};
}

function collectFiles(messages: Message[]): FileCandidate[] {
	const files: FileCandidate[] = [];
	for (const message of messages) {
		const parts =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: Array.isArray(message.content)
					? message.content
					: [];
		for (const part of parts) {
			if (part.type === "text" && part.text) {
				for (const match of part.text.matchAll(TEXT_DATA_URI)) {
					files.push({
						mimeType: match[1] ?? null,
						bytes: base64Bytes(match[2] ?? ""),
					});
				}
			} else if (part.type === "image_url" && part.image_url?.url) {
				const { url } = part.image_url;
				files.push(
					url.startsWith("data:")
						? fromDataUri(url)
						: { mimeType: mimeFromName(safePathname(url)), bytes: null },
				);
			} else if (part.type === "image" && part.source?.data) {
				files.push({
					mimeType: part.source.media_type ?? null,
					bytes: base64Bytes(part.source.data),
				});
			} else if (part.type === "input_audio" && part.input_audio?.data) {
				files.push({
					mimeType:
						AUDIO_FORMAT_MIME_TYPES[part.input_audio.format ?? ""] ?? null,
					bytes: base64Bytes(part.input_audio.data),
				});
			} else if (part.type === "file" && part.file?.file_data) {
				const data = part.file.file_data;
				const file = data.startsWith("data:")
					? fromDataUri(data)
					: { mimeType: null, bytes: base64Bytes(data) };
				files.push({
					mimeType: file.mimeType ?? mimeFromName(part.file.filename),
					bytes: file.bytes,
				});
			}
		}
	}
	return files;
}

function safePathname(url: string): string | undefined {
	try {
		return new URL(url).pathname;
	} catch {
		return undefined;
	}
}

/**
 * Checks every attached file against the configured types and size. A file
 * whose type cannot be determined (remote URL without an extension, raw
 * base64) is only size-checked.
 */
export function checkMessageFiles(
	messages: Message[],
	limits: FileLimits,
): string[] {
	const maxBytes = limits.maxFileSizeMb * 1024 * 1024;
	const matches = new Set<string>();
	for (const file of collectFiles(messages)) {
		if (
			file.mimeType &&
			!isFileTypeAllowed(file.mimeType, limits.allowedFileTypes)
		) {
			matches.add(`Blocked file type: ${file.mimeType.toLowerCase()}`);
		}
		if (
			limits.maxFileSizeMb > 0 &&
			file.bytes !== null &&
			file.bytes > maxBytes
		) {
			matches.add(`File larger than ${limits.maxFileSizeMb} MB`);
		}
	}
	return [...matches];
}

export const fileTypesRule = {
	id: "system:file_types",
	name: "File Type Restrictions",
	category: "files",
	defaultEnabled: true,
	defaultAction: "block",
} as const;
