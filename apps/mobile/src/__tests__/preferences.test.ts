import * as Keychain from "react-native-keychain";

import { queryClient } from "@/api/client";
import {
	chatSettingsFromFields,
	defaultChatSettings,
	loadPreferences,
	saveChatSettings,
} from "@/lib/preferences";

jest.mock("@/api/client", () => ({ queryClient: { setQueryData: jest.fn() } }));
jest.mock("react-native-keychain", () => ({
	getGenericPassword: jest.fn(),
	setGenericPassword: jest.fn(),
	resetGenericPassword: jest.fn(),
	ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WhenUnlockedThisDeviceOnly" },
	STORAGE_TYPE: { AES_GCM_NO_AUTH: "AES_GCM_NO_AUTH" },
}));
beforeEach(() => jest.resetAllMocks());

test("uses defaults on a new installation", async () => {
	jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
	expect(await loadPreferences()).toEqual({ chat: defaultChatSettings });
});

test("restores validated settings from Keychain", async () => {
	const chat = {
		...defaultChatSettings,
		systemPrompt: "Be concise",
		temperature: 0.7,
		maxTokens: 512,
		webSearch: true,
	};
	jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
		username: "preferences",
		password: JSON.stringify({ chat }),
		service: "preferences",
		storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
	});
	expect(await loadPreferences()).toEqual({ chat });
});

test("does not update cached settings when secure storage fails", async () => {
	jest
		.mocked(Keychain.setGenericPassword)
		.mockRejectedValue(new Error("Storage unavailable"));
	await expect(saveChatSettings(defaultChatSettings)).rejects.toThrow(
		"Storage unavailable",
	);
	expect(queryClient.setQueryData).not.toHaveBeenCalled();
});

test("clears optional numeric overrides when fields are blank", () => {
	expect(
		chatSettingsFromFields(
			{ ...defaultChatSettings, temperature: 1, maxTokens: 512 },
			" ",
			"",
		),
	).toEqual(defaultChatSettings);
});

test.each([
	["-1", "512"],
	["2.1", "512"],
	["bad", "512"],
	["1", "0"],
	["1", "1.5"],
])(
	"rejects invalid temperature %s or token limit %s",
	(temperature, maxTokens) => {
		expect(() =>
			chatSettingsFromFields(defaultChatSettings, temperature, maxTokens),
		).toThrow();
	},
);
