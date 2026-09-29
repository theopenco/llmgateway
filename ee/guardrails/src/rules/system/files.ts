import { defaultAllowedFileTypes } from "@llmgateway/db";

import type { SystemRule } from "@/types.js";

export function checkFileType(
	fileType: string,
	allowedTypes: string[],
): boolean {
	return allowedTypes.some(
		(allowed) =>
			allowed.toLowerCase() === fileType.split(";")[0].trim().toLowerCase(),
	);
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
