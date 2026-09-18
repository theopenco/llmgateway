import { types } from "@react-native-documents/picker";

import { pickFile } from "@/lib/files";

const supportedExtension =
	/\.(txt|md|markdown|mdx|csv|tsv|json|yaml|yml|xml|html|log|js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|css|pdf|xlsx)$/i;

export async function pickKnowledgeFile() {
	const file = await pickFile([types.allFiles]);
	if (file && !supportedExtension.test(file.name)) {
		throw new Error("Choose a PDF, XLSX, text, or source-code file.");
	}
	return file;
}
