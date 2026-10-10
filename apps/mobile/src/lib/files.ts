import {
	errorCodes,
	isErrorWithCode,
	pick,
	types,
} from "@react-native-documents/picker";
import { FileSystem } from "react-native-file-access";

export async function pickFile(
	allowedTypes: string[] = [
		types.pdf,
		types.plainText,
		...[types.csv].flat(),
		types.xls,
		types.xlsx,
	],
) {
	try {
		const [file] = await pick({ mode: "import", type: allowedTypes });
		if (file.error) {
			throw new Error(file.error);
		}
		if (!file.hasRequestedType) {
			throw new Error("Choose a supported file type.");
		}
		const path = decodeURIComponent(file.uri.replace(/^file:\/\//, ""));
		try {
			const stat = await FileSystem.stat(path);
			if (stat.size > 10_000_000) {
				throw new Error("Choose a file smaller than 10 MB.");
			}
			const base64 = await FileSystem.readFile(path, "base64");
			return {
				name: file.name ?? "attachment",
				mimeType: file.type ?? "application/octet-stream",
				base64,
			};
		} finally {
			await FileSystem.unlink(path);
		}
	} catch (error) {
		if (
			isErrorWithCode(error) &&
			error.code === errorCodes.OPERATION_CANCELED
		) {
			return null;
		}
		throw error;
	}
}
