import { logger } from "@llmgateway/logger";

function getFileSizeErrorMessage(
	maxSizeMB: number,
	actualSizeMB: number,
	userPlan: "free" | "pro" | "enterprise" | null,
): string {
	const isHosted = process.env.HOSTED === "true";
	const isPaidMode = process.env.PAID_MODE === "true";

	let message = `File size (${actualSizeMB.toFixed(1)}MB) exceeds your current limit of ${maxSizeMB}MB.`;

	if (isHosted && isPaidMode) {
		if (userPlan === "enterprise") {
			message += ` Contact us to increase your Enterprise plan limits.`;
		} else {
			message += ` Contact us for Enterprise plans with higher limits.`;
		}
	}

	return message;
}

const ALLOWED_FILE_MIME_PREFIXES = ["application/pdf"];

function isAllowedFileMime(mimeType: string): boolean {
	return ALLOWED_FILE_MIME_PREFIXES.some(
		(prefix) => mimeType === prefix || mimeType.startsWith(prefix),
	);
}

/**
 * Processes a file URL (data URL or https URL) and returns its base64 contents
 * plus mime type. Mirrors process-image-url but accepts document MIME types
 * (currently only application/pdf).
 */
export async function processFileUrl(
	url: string,
	isProd = false,
	maxSizeMB = 32,
	userPlan: "free" | "pro" | "enterprise" | null = null,
): Promise<{ data: string; mimeType: string }> {
	if (url.startsWith("data:")) {
		const dataUrlMatch = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/);
		if (!dataUrlMatch) {
			logger.warn("Invalid file data URL format provided");
			throw new Error("Invalid file data URL format");
		}

		const [, mimeType, data] = dataUrlMatch;

		if (!isAllowedFileMime(mimeType)) {
			logger.warn("Unsupported MIME type in file data URL", { mimeType });
			throw new Error(`Unsupported file type: ${mimeType}`);
		}

		const isBase64 = url.includes(";base64,");
		const base64Data = isBase64 ? data : btoa(data);

		const estimatedSize = (base64Data.length * 3) / 4;
		const maxSizeBytes = maxSizeMB * 1024 * 1024;
		if (estimatedSize > maxSizeBytes) {
			const actualSizeMB = estimatedSize / (1024 * 1024);
			throw new Error(
				getFileSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
		}

		return { data: base64Data, mimeType };
	}

	if (!url.startsWith("https://") && isProd) {
		logger.warn("Non-HTTPS URL provided for file fetch in production", {
			url: url.substring(0, 20) + "...",
		});
		throw new Error("File URLs must use HTTPS protocol in production");
	}

	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch file: HTTP ${response.status}`);
		}

		const maxSizeBytes = maxSizeMB * 1024 * 1024;
		const contentLength = response.headers.get("content-length");
		if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
			const actualSizeMB = parseInt(contentLength, 10) / (1024 * 1024);
			throw new Error(
				getFileSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
		}

		const contentType =
			response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
		if (!isAllowedFileMime(contentType)) {
			throw new Error(`URL does not point to a supported file type`);
		}

		const arrayBuffer = await response.arrayBuffer();
		if (arrayBuffer.byteLength > maxSizeBytes) {
			const actualSizeMB = arrayBuffer.byteLength / (1024 * 1024);
			throw new Error(
				getFileSizeErrorMessage(maxSizeMB, actualSizeMB, userPlan),
			);
		}

		const uint8Array = new Uint8Array(arrayBuffer);
		const binaryString = Array.from(uint8Array, (byte) =>
			String.fromCharCode(byte),
		).join("");
		const base64 = btoa(binaryString);

		return { data: base64, mimeType: contentType };
	} catch (error) {
		logger.error("Error processing file URL", {
			err: error instanceof Error ? error : new Error(String(error)),
			url: url.substring(0, 50) + "...",
		});
		if (
			error instanceof Error &&
			(error.message.includes("File size") ||
				error.message.includes("Failed to fetch file") ||
				error.message.includes("Unsupported file type") ||
				error.message.includes("URL does not point to a supported file type") ||
				error.message.includes("must use HTTPS"))
		) {
			throw error;
		}
		throw new Error("Failed to process file from URL");
	}
}

/**
 * Resolves a `FileContent` `file` block into base64 + mime type. Accepts
 * either an OpenAI-style `file_data` (data URL or https URL) or rejects when
 * only `file_id` is provided.
 */
export async function processFileContent(
	file: { file_data?: string; filename?: string; file_id?: string },
	isProd = false,
	maxSizeMB = 32,
	userPlan: "free" | "pro" | "enterprise" | null = null,
): Promise<{ data: string; mimeType: string }> {
	if (file.file_id && !file.file_data) {
		throw new Error(
			"file content with file_id is only supported on the OpenAI provider; please supply file_data instead",
		);
	}
	if (!file.file_data) {
		throw new Error("file content requires file_data");
	}
	return await processFileUrl(file.file_data, isProd, maxSizeMB, userPlan);
}
