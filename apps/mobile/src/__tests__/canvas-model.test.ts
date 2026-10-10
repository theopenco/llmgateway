import * as Keychain from "react-native-keychain";

import { queryClient } from "@/api/client";
import {
	clearCanvasModel,
	loadCanvasModel,
	saveCanvasModel,
} from "@/lib/canvas-model";

jest.mock("@/api/client", () => ({ queryClient: { setQueryData: jest.fn() } }));
jest.mock("react-native-keychain", () => ({
	getGenericPassword: jest.fn(),
	setGenericPassword: jest.fn(),
	resetGenericPassword: jest.fn(),
	ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device" },
	STORAGE_TYPE: { AES_GCM_NO_AUTH: "AES_GCM_NO_AUTH" },
}));
beforeEach(() => jest.resetAllMocks());

test("restores the selected model and defaults to Auto only when none is saved", async () => {
	jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
	expect(await loadCanvasModel()).toBe("auto");
	jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
		username: "model",
		password: "selected-model",
		service: "canvas",
		storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
	});
	expect(await loadCanvasModel()).toBe("selected-model");
});

test("does not change the active model if saving fails", async () => {
	jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
	await expect(saveCanvasModel("selected-model")).rejects.toThrow(
		"could not be saved",
	);
	expect(queryClient.setQueryData).not.toHaveBeenCalled();
});

test("sign-out clears a pending model write before it can reactivate the preference", async () => {
	let complete: (
		value: Awaited<ReturnType<typeof Keychain.setGenericPassword>>,
	) => void = () => undefined;
	jest.mocked(Keychain.setGenericPassword).mockImplementation(
		() =>
			new Promise((resolve) => {
				complete = resolve;
			}),
	);
	const save = saveCanvasModel("selected-model");
	await Promise.resolve();
	const clear = clearCanvasModel();
	expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
	complete({
		service: "canvas",
		storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
	});
	await save;
	await clear;
	expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
		service: "io.llmgateway.lounge.canvas-model",
	});
	expect(queryClient.setQueryData).not.toHaveBeenCalled();
});
