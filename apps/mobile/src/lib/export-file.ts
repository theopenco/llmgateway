import {
	errorCodes,
	isErrorWithCode,
	saveDocuments,
} from "@react-native-documents/picker";
import { Share } from "react-native";
import { Dirs, FileSystem } from "react-native-file-access";

let exportSequence = 0;

function temporaryPath(name: string) {
	return `${Dirs.CacheDir}/Lounge-${Date.now()}-${++exportSequence}-${name.replace(/[\\/]/g, "-")}`;
}

export async function exportRemoteFile(
	file: { url: string; name: string },
	action: "save" | "share",
) {
	const path = temporaryPath(file.name);
	try {
		const response = await FileSystem.fetch(file.url, { path });
		if (!response.ok) {
			throw new Error(
				`Download failed (${response.status}). Try refreshing the video.`,
			);
		}
		await exportLocalFile(path, action);
	} finally {
		if (await FileSystem.exists(path)) {
			await FileSystem.unlink(path);
		}
	}
}

export async function exportFile(
	file: { base64: string; name: string },
	action: "save" | "share",
) {
	const path = temporaryPath(file.name);
	await FileSystem.writeFile(path, file.base64, "base64");
	try {
		await exportLocalFile(path, action);
	} finally {
		await FileSystem.unlink(path);
	}
}

export async function exportLocalFile(path: string, action: "save" | "share") {
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
	}
}
