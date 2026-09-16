import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";
import { Appearance, Settings, Text, TextInput, View } from "react-native";

import { AppearancePicker } from "@/components/AppearancePicker";

jest.useFakeTimers();
beforeEach(() => {
	jest.spyOn(Settings, "get").mockReturnValue("system");
	jest.spyOn(Settings, "set").mockImplementation((values) => {
		jest
			.mocked(Settings.get)
			.mockReturnValue(
				"loungeAppearance" in values ? values.loungeAppearance : undefined,
			);
	});
	jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function Draft() {
	const [value, setValue] = useState("");
	return (
		<View>
			<TextInput
				accessibilityLabel="Draft"
				value={value}
				onChangeText={setValue}
			/>
			<Text>{value}</Text>
			<AppearancePicker />
		</View>
	);
}
async function show() {
	await render(
		<QueryClientProvider client={new QueryClient()}>
			<Draft />
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

test("announces the current choice and changes appearance without replacing draft state", async () => {
	const user = await show();
	expect(
		screen.getByRole("radio", { name: "System appearance" }),
	).toBeChecked();
	await user.type(screen.getByLabelText("Draft"), "Keep this draft");
	await user.press(screen.getByRole("radio", { name: "Light appearance" }));
	expect(screen.getByRole("radio", { name: "Light appearance" })).toBeChecked();
	expect(screen.getByLabelText("Draft")).toHaveDisplayValue("Keep this draft");
	await user.press(screen.getByRole("radio", { name: "Dark appearance" }));
	expect(screen.getByRole("radio", { name: "Dark appearance" })).toBeChecked();
	await user.press(screen.getByRole("radio", { name: "System appearance" }));
	expect(
		screen.getByRole("radio", { name: "System appearance" }),
	).toBeChecked();
	expect(Appearance.setColorScheme).toHaveBeenLastCalledWith("auto");
});

test("reports a failed preference write and keeps the prior selection", async () => {
	jest.mocked(Settings.set).mockImplementationOnce(() => {
		throw new Error("Could not save appearance");
	});
	const user = await show();
	await user.press(screen.getByRole("radio", { name: "Dark appearance" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Could not save appearance",
	);
	expect(
		screen.getByRole("radio", { name: "System appearance" }),
	).toBeChecked();
	await user.press(screen.getByRole("radio", { name: "Dark appearance" }));
	expect(screen.getByRole("radio", { name: "Dark appearance" })).toBeChecked();
	expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
});
