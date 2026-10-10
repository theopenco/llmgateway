import * as Keychain from "react-native-keychain";

import { queryClient } from "@/api/client";
import {
	loadEscapeModel,
	saveEscapeModel,
	clearEscapeModel,
} from "@/lib/escape-model";

jest.mock("@/api/client", () => ({ queryClient: { setQueryData: jest.fn() } }));
jest.mock("react-native-keychain", () => ({
	getGenericPassword: jest.fn(),
	setGenericPassword: jest.fn(),
	resetGenericPassword: jest.fn(),
	ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device" },
	STORAGE_TYPE: { AES_GCM_NO_AUTH: "aes" },
}));
beforeEach(() => jest.resetAllMocks());
test("uses the Escape default and its own preference independently of Canvas", async () => {
	jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
	expect(await loadEscapeModel()).toBe("openai/gpt-5-mini");
	jest.mocked(Keychain.setGenericPassword).mockResolvedValue({
		service: "escape",
		storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
	});
	await saveEscapeModel("chosen-model");
	expect(queryClient.setQueryData).toHaveBeenCalledWith(
		["escape-model"],
		"chosen-model",
	);
	expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
		"model",
		"chosen-model",
		expect.objectContaining({ service: "io.llmgateway.lounge.escape-model" }),
	);
	await clearEscapeModel();
	expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
		service: "io.llmgateway.lounge.escape-model",
	});
});
test("reports unavailable Keychain storage without silently choosing a different model", async () => {
	jest
		.mocked(Keychain.getGenericPassword)
		.mockRejectedValue(new Error("Keychain unavailable"));
	await expect(loadEscapeModel()).rejects.toThrow("Keychain unavailable");
});
