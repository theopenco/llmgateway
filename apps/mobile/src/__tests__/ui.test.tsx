import { render, screen, userEvent } from "@testing-library/react-native";
import { StyleSheet, useColorScheme } from "react-native";

import { Button, ErrorNotice, Field, Icon, IconButton } from "@/components/ui";
import { palettes } from "@/lib/colors";

import type { ViewStyle } from "react-native";

jest.useFakeTimers();
afterEach(() => jest.mocked(useColorScheme).mockReturnValue("light"));

test.each(["mic", "copy", "more"] as const)(
	"resolves %s borders when the app appearance changes",
	async (name) => {
		await render(<Icon name={name} />);
		for (const scheme of ["light", "dark"] as const) {
			jest.mocked(useColorScheme).mockReturnValue(scheme);
			await screen.rerender(<Icon name={name} />);
			const borders = screen.container.queryAll(
				(node) =>
					!!StyleSheet.flatten<ViewStyle>(node.props.style)?.borderWidth,
			);
			expect(borders.length).toBeGreaterThan(0);
			for (const border of borders) {
				expect(border).toHaveStyle({ borderColor: palettes[scheme].text });
			}
		}
	},
);

test("filled icon buttons resolve their contrasting dark-theme color", async () => {
	jest.mocked(useColorScheme).mockReturnValue("dark");
	await render(
		<IconButton
			name="stop"
			variant="filled"
			accessibilityLabel="Stop recording"
			onPress={jest.fn()}
		/>,
	);
	const borders = screen
		.getByRole("button", { name: "Stop recording" })
		.queryAll(
			(node) => !!StyleSheet.flatten<ViewStyle>(node.props.style)?.borderWidth,
		);
	expect(borders).toHaveLength(1);
	expect(borders[0]).toHaveStyle({
		borderColor: palettes.dark.ink,
		backgroundColor: palettes.dark.ink,
	});
});

test("prevents repeat submissions while a request is pending", async () => {
	const press = jest.fn();
	const user = userEvent.setup();
	await render(<Button title="Save skill" onPress={press} busy />);
	expect(screen.getByRole("button", { name: "Save skill" })).toBeDisabled();
	await user.press(screen.getByRole("button", { name: "Save skill" }));
	expect(press).not.toHaveBeenCalled();
	await screen.rerender(<Button title="Save skill" onPress={press} />);
	await user.press(screen.getByRole("button", { name: "Save skill" }));
	expect(press).toHaveBeenCalledTimes(1);
});

test("labels fields for assistive technology and accepts typing", async () => {
	const changed = jest.fn();
	await render(<Field label="Project name" onChangeText={changed} />);
	await userEvent
		.setup()
		.type(screen.getByLabelText("Project name"), "Writing");
	expect(changed).toHaveBeenLastCalledWith("Writing");
});

test("announces actionable errors", async () => {
	await render(
		<ErrorNotice error={new Error("Check your connection and try again.")} />,
	);
	expect(screen.getByRole("alert")).toHaveTextContent(
		"Check your connection and try again.",
	);
});
