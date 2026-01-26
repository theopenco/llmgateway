import { defaultAllowedFileTypes } from "@llmgateway/db";

import type { SystemRule } from "@/types.js";

export function checkFileType(
	fileType: string,
	allowedTypes: string[],
): boolean {
	return allowedTypes.includes(fileType);
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
	check: (content, config) => {
		// This rule is checked separately for file uploads
		// The content check here is for base64 encoded files in messages
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		const matches: string[] = [];

		// Check for base64 data URIs with potentially dangerous types
		const dataUriPattern = /data:([^;]+);base64,[A-Za-z0-9+/]+=*/g;
		let match;
		while ((match = dataUriPattern.exec(content)) !== null) {
			const mimeType = match[1];
			if (!defaultAllowedFileTypes.includes(mimeType)) {
				matches.push(`Blocked file type: ${mimeType}`);
			}
		}

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
