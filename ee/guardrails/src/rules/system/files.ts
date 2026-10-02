import { defaultAllowedFileTypes } from "@llmgateway/db";

import type { SystemRule } from "@/types.js";

// The dashboard stores extensions ("pdf"); the API default stores MIME types.
// Extensions whose MIME subtype differs from the extension itself:
const EXTENSION_MIME_TYPES: Record<string, string[]> = {
	jpg: ["image/jpeg"],
	txt: ["text/plain"],
	md: ["text/markdown", "text/x-markdown"],
	xml: ["application/xml", "text/xml"],
	mp3: ["audio/mpeg"],
	m4a: ["audio/mp4"],
	wav: ["audio/wav", "audio/x-wav"],
};

function allowsType(allowed: string, mimeType: string): boolean {
	const entry = allowed.trim().toLowerCase().replace(/^\./, "");
	if (entry.includes("/")) {
		return entry.endsWith("/*")
			? mimeType.startsWith(entry.slice(0, -1))
			: entry === mimeType;
	}
	return (
		EXTENSION_MIME_TYPES[entry]?.includes(mimeType) ??
		mimeType.split("/")[1] === entry
	);
}

export function checkFileType(
	fileType: string,
	allowedTypes: string[],
): boolean {
	const mimeType = fileType.split(";")[0].trim().toLowerCase();
	return allowedTypes.some((allowed) => allowsType(allowed, mimeType));
}

export function checkFileSize(sizeMb: number, maxSizeMb: number): boolean {
	return sizeMb <= maxSizeMb;
}

export const fileTypesRule: SystemRule = {
	id: "system:file_types",
	name: "File Type Restrictions",
	category: "files",
	defaultEnabled: true,
	defaultAction: "block",
	check: (content, config, allowedTypes = defaultAllowedFileTypes) => {
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		const matches: string[] = [];

		// Data URIs with a type/subtype; the lookbehind skips prose like "metadata:a,b".
		const dataUriPattern =
			/(?<![\w-])data:([\w!#$&^.+-]+\/[\w!#$&^.+-]+)(?:;[^,\s]*)?,/gi;
		let match;
		while ((match = dataUriPattern.exec(content)) !== null) {
			const mimeType = match[1];
			if (!checkFileType(mimeType, allowedTypes)) {
				matches.push(`Blocked file type: ${mimeType}`);
			}
		}

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
