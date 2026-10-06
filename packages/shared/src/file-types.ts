// The dashboard stores extensions ("pdf"); the API default stores MIME types.
// Extensions whose MIME subtype differs from the extension itself:
const EXTENSION_MIME_TYPES: Record<string, string[]> = {
	jpg: ["image/jpeg"],
	txt: ["text/plain"],
	md: ["text/markdown", "text/x-markdown"],
	xml: ["application/xml", "text/xml"],
	htm: ["text/html"],
	svg: ["image/svg+xml"],
	mp3: ["audio/mpeg"],
	mpga: ["audio/mpeg"],
	m4a: ["audio/mp4"],
	wav: ["audio/wav", "audio/x-wav"],
	doc: ["application/msword"],
	docx: [
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	],
	xls: ["application/vnd.ms-excel"],
	xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
	ppt: ["application/vnd.ms-powerpoint"],
	pptx: [
		"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	],
	odt: ["application/vnd.oasis.opendocument.text"],
	ods: ["application/vnd.oasis.opendocument.spreadsheet"],
	js: ["text/javascript", "application/javascript"],
	yml: ["application/yaml", "text/yaml", "application/x-yaml"],
	yaml: ["application/yaml", "text/yaml", "application/x-yaml"],
};

// Extensions that match their MIME subtype directly ("pdf" → application/pdf).
const SUBTYPE_EXTENSIONS = new Set([
	"pdf",
	"png",
	"jpeg",
	"gif",
	"webp",
	"heic",
	"heif",
	"bmp",
	"tiff",
	"avif",
	"csv",
	"json",
	"html",
	"rtf",
	"zip",
	"gzip",
	"mp4",
	"mpeg",
	"webm",
	"ogg",
	"flac",
	"aac",
	"opus",
	"css",
]);

// Non-standard spellings clients still send for a standard type.
const MIME_TYPE_ALIASES: Record<string, string> = {
	"image/jpg": "image/jpeg",
};

export function normalizeMimeType(mimeType: string): string {
	return MIME_TYPE_ALIASES[mimeType] ?? mimeType;
}

function normalizeEntry(allowed: string): string {
	return allowed.trim().toLowerCase().replace(/^\./, "");
}

/**
 * Whether an allow-list entry can ever match: a MIME type (`image/png`,
 * `image/*`) or an extension this rule knows how to map.
 */
export function isRecognizedFileTypeEntry(allowed: string): boolean {
	const entry = normalizeEntry(allowed);
	if (entry.includes("/")) {
		return /^[\w.+-]+\/(\*|[\w.+-]+)$/.test(entry);
	}
	return entry in EXTENSION_MIME_TYPES || SUBTYPE_EXTENSIONS.has(entry);
}

export function allowsFileType(allowed: string, mimeType: string): boolean {
	const entry = normalizeEntry(allowed);
	if (entry.includes("/")) {
		return entry.endsWith("/*")
			? mimeType.startsWith(entry.slice(0, -1))
			: normalizeMimeType(entry) === mimeType;
	}
	const subtype = mimeType.split("/")[1] ?? "";
	return (
		EXTENSION_MIME_TYPES[entry]?.includes(mimeType) ??
		(subtype === entry || subtype.split("+")[0] === entry)
	);
}
