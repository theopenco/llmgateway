import { saveDocuments } from "@react-native-documents/picker";
import { Share } from "react-native";
import { FileSystem } from "react-native-file-access";

import { exportImage } from "@/lib/export-image";

jest.mock("@react-native-documents/picker", () => ({
	saveDocuments: jest.fn(),
	errorCodes: { OPERATION_CANCELED: "canceled" },
	isErrorWithCode: (error: unknown) =>
		!!error && typeof error === "object" && "code" in error,
}));
jest.mock("react-native-file-access", () => ({
	Dirs: { CacheDir: "/cache" },
	FileSystem: { writeFile: jest.fn(), unlink: jest.fn() },
}));
const image = { base64: "fixture", mediaType: "image/png" };
beforeEach(() => jest.resetAllMocks());

test("keeps the original until a copy is saved, then removes temporary data", async () => {
	jest.mocked(saveDocuments).mockImplementation(async () => {
		expect(FileSystem.unlink).not.toHaveBeenCalled();
		return [{ uri: "file:///saved.png", name: "saved.png", error: null }];
	});
	await exportImage(image, "save");
	expect(saveDocuments).toHaveBeenCalledWith({
		sourceUris: [expect.stringMatching(/^file:\/\/\/cache\/Lounge-.*\.png$/)],
		copy: true,
	});
	expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
});

test("cancellation clears the temporary copy without an error", async () => {
	jest.mocked(saveDocuments).mockRejectedValue({ code: "canceled" });
	await expect(exportImage(image, "save")).resolves.toBeUndefined();
	expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
});

test("reports per-file save errors and removes the temporary copy", async () => {
	jest
		.mocked(saveDocuments)
		.mockResolvedValue([{ uri: "", name: null, error: "Disk full" }]);
	await expect(exportImage(image, "save")).rejects.toThrow("Disk full");
	expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
});

test("shares a local image file and removes it after the sheet finishes", async () => {
	const share = jest
		.spyOn(Share, "share")
		.mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
	await exportImage(image, "share");
	expect(share).toHaveBeenCalledWith({ url: expect.stringMatching(/\.png$/) });
	expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
});
