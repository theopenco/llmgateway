import {
	errorCodes,
	isErrorWithCode,
	saveDocuments,
} from "@react-native-documents/picker";
import { Share } from "react-native";
import { Dirs, FileSystem } from "react-native-file-access";

let exportSequence = 0;

export async function exportFile(
	file: { base64: string; name: string },
	action: "save" | "share",
) {
	const name = file.name.replace(/[\\/]/g, "-");
	const path = `${Dirs.CacheDir}/Lounge-${Date.now()}-${++exportSequence}-${name}`;
	await FileSystem.writeFile(path, file.base64, "base64");
	try {
		const url = `file://${path.split("/").map(encodeURIComponent).join("/")}`;
		if (action === "share") {
			await Share.share({ url });
		} else {
			const saved = await saveDocuments({ sourceUris: [url], copy: true });
			const failed = saved.find((file) => file.error);
			if (failed) {
				throw new Error(failed.error ?? "The file could not be saved.");
			}
		}
	} catch (error) {
		if (
			!isErrorWithCode(error) ||
			error.code !== errorCodes.OPERATION_CANCELED
		) {
			throw error;
		}
	} finally {
		await FileSystem.unlink(path);
	}
}
