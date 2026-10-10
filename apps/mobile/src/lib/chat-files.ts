import { pickFile } from "@/lib/files";

import type { Attachment } from "@/api/chat-messages";

let sequence = 0;
export async function pickChatAttachment(): Promise<Attachment | null> {
	const file = await pickFile([
		"public.image",
		"public.audio",
		"com.adobe.pdf",
		"public.text",
		"public.comma-separated-values-text",
		"org.openxmlformats.wordprocessingml.document",
		"org.openxmlformats.spreadsheetml.sheet",
	]);
	return file
		? {
				id: `attachment-${++sequence}`,
				name: file.name,
				mediaType: file.mimeType,
				url: `data:${file.mimeType};base64,${file.base64}`,
			}
		: null;
}
