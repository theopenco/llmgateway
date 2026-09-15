import { render, screen, userEvent } from "@testing-library/react-native";

import { Button, ErrorNotice, Field } from "@/components/ui";

jest.useFakeTimers();

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
