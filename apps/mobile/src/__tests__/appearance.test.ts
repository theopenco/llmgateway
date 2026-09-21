import { Appearance, Settings } from "react-native";

import {
	applyAppearancePreference,
	getAppearancePreference,
	setAppearancePreference,
} from "@/lib/appearance";

beforeEach(() => {
	jest.spyOn(Settings, "get").mockReturnValue(undefined);
	jest.spyOn(Settings, "set").mockImplementation(() => {});
	jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("a new installation follows the system and releases an old native override", () => {
	expect(getAppearancePreference()).toBe("system");
	applyAppearancePreference();
	expect(Appearance.setColorScheme).toHaveBeenCalledWith("auto");
});

test.each(["light", "dark"] as const)(
	"restores the saved %s override on startup",
	(value) => {
		jest.mocked(Settings.get).mockReturnValue(value);
		applyAppearancePreference();
		expect(Appearance.setColorScheme).toHaveBeenCalledWith(value);
	},
);

test("persists an explicit choice and removes the override when System is chosen", () => {
	jest.mocked(Settings.set).mockImplementation((values) => {
		jest
			.mocked(Settings.get)
			.mockReturnValue(
				"loungeAppearance" in values ? values.loungeAppearance : undefined,
			);
	});
	setAppearancePreference("dark");
	expect(Settings.set).toHaveBeenLastCalledWith({ loungeAppearance: "dark" });
	expect(Appearance.setColorScheme).toHaveBeenLastCalledWith("dark");
	setAppearancePreference("system");
	expect(Settings.set).toHaveBeenLastCalledWith({ loungeAppearance: "system" });
	expect(Appearance.setColorScheme).toHaveBeenLastCalledWith("auto");
});

test("an unrecognized saved preference follows the system", () => {
	jest.mocked(Settings.get).mockReturnValue({ invalid: "choice" });
	expect(getAppearancePreference()).toBe("system");
});
