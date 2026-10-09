import { defaultAllowedFileTypes } from "@llmgateway/db";
import {
	allowsFileType,
	normalizeMimeType,
} from "@llmgateway/shared/file-types";

import type { SystemRule } from "@/types.js";

export function checkFileType(
	fileType: string,
	allowedTypes: string[],
): boolean {
	const mimeType = normalizeMimeType(
		fileType.split(";")[0].trim().toLowerCase(),
	);
	return allowedTypes.some((allowed) => allowsFileType(allowed, mimeType));
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

		const blocked = new Set<string>();

		// Data URIs with a type/subtype; the lookbehind skips prose like
		// "metadata:a,b". A data URI's parameters run to a comma before any
		// whitespace. Scanning them in the pattern backtracks quadratically on
		// repeated "data:a/a;" text, so the comma is found with forward-only
		// pointers instead: linear, and with no cap a long parameter list could
		// use to slip past the check.
		const dataUriPattern =
			/(?<![\w-])data:([\w!#$&^.+-]+\/[\w!#$&^.+-]+)(?=[;,])/gi;
		const whitespace = /\s/g;
		let nextComma = -1;
		let nextWhitespace = -1;
		let match;
		while ((match = dataUriPattern.exec(content)) !== null) {
			const end = dataUriPattern.lastIndex;
			if (nextComma !== Infinity && nextComma < end) {
				const index = content.indexOf(",", end);
				nextComma = index === -1 ? Infinity : index;
			}
			if (nextWhitespace !== Infinity && nextWhitespace < end) {
				whitespace.lastIndex = end;
				nextWhitespace = whitespace.exec(content)?.index ?? Infinity;
			}
			if (nextComma === Infinity || nextComma > nextWhitespace) {
				continue;
			}
			const mimeType = match[1];
			if (!checkFileType(mimeType, allowedTypes)) {
				blocked.add(normalizeMimeType(mimeType.toLowerCase()));
			}
		}
		const matches = [...blocked].map((type) => `Blocked file type: ${type}`);

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
