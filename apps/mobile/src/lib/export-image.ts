import {
	errorCodes,
	isErrorWithCode,
	saveDocuments,
} from "@react-native-documents/picker";
import { Share } from "react-native";
import { Dirs, FileSystem } from "react-native-file-access";

import type { GeneratedImage } from "@/api/images";

let exportSequence = 0;

export async function exportImage(
	image: GeneratedImage,
	action: "save" | "share",
) {
	const extension =
		image.mediaType === "image/jpeg"
			? "jpg"
			: image.mediaType === "image/webp"
				? "webp"
				: "png";
	const path = `${Dirs.CacheDir}/Lounge-${Date.now()}-${++exportSequence}.${extension}`;
	await FileSystem.writeFile(path, image.base64, "base64");
	try {
		const url = `file://${path}`;
		if (action === "share") {
			await Share.share({ url });
		} else {
			const saved = await saveDocuments({ sourceUris: [url], copy: true });
			const failed = saved.find((file) => file.error);
			if (failed) {
				throw new Error(failed.error ?? "The image could not be saved.");
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
