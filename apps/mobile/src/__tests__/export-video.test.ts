import { saveDocuments } from "@react-native-documents/picker";
import { FileSystem } from "react-native-file-access";

import { exportRemoteFile } from "@/lib/export-file";

jest.mock("@react-native-documents/picker", () => ({
	saveDocuments: jest.fn(),
	errorCodes: { OPERATION_CANCELED: "canceled" },
	isErrorWithCode: (error: unknown) =>
		!!error && typeof error === "object" && "code" in error,
}));
jest.mock("react-native-file-access", () => ({
	Dirs: { CacheDir: "/cache" },
	FileSystem: { fetch: jest.fn(), exists: jest.fn(), unlink: jest.fn() },
}));
beforeEach(() => {
	jest.resetAllMocks();
	jest.mocked(FileSystem.exists).mockResolvedValue(true);
});

test("downloads directly to disk and keeps the file until saving finishes", async () => {
	jest
		.mocked(FileSystem.fetch)
		.mockResolvedValue({ ok: true } as Awaited<
			ReturnType<typeof FileSystem.fetch>
		>);
	jest.mocked(saveDocuments).mockImplementation(async () => {
		expect(FileSystem.unlink).not.toHaveBeenCalled();
		return [{ uri: "file:///saved.mp4", name: "saved.mp4", error: null }];
	});
	await exportRemoteFile(
		{ url: "https://example.com/video", name: "video.mp4" },
		"save",
	);
	expect(FileSystem.fetch).toHaveBeenCalledWith("https://example.com/video", {
		path: expect.stringMatching(/\/cache\/Lounge-.*\.mp4$/),
	});
	expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
});

test("cleans up partial downloads and never exports an HTTP error body", async () => {
	jest
		.mocked(FileSystem.fetch)
		.mockResolvedValue({ ok: false, status: 403 } as Awaited<
			ReturnType<typeof FileSystem.fetch>
		>);
	await expect(
		exportRemoteFile(
			{ url: "https://example.com/expired", name: "video.mp4" },
			"save",
		),
	).rejects.toThrow("403");
	expect(saveDocuments).not.toHaveBeenCalled();
	expect(FileSystem.unlink).toHaveBeenCalledTimes(1);
});
