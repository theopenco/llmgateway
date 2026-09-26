import { render, screen, userEvent } from "@testing-library/react-native";

import { ToolCalls } from "@/components/ToolCalls";

import type { ToolPart } from "@/api/tool-parts";

const part: ToolPart = {
	type: "dynamic-tool",
	toolCallId: "call",
	toolName: "gmail__search_messages",
	state: "approval-requested",
	input: { query: "demo" },
	approval: { id: "approval", signature: "fixture-signature" },
};

test("shows the exact action and arguments and requires an explicit decision", async () => {
	const onAnswer = jest.fn();
	await render(<ToolCalls parts={[part]} onAnswer={onAnswer} />);
	expect(screen.getByText(/"query": "demo"/)).toBeVisible();
	expect(onAnswer).not.toHaveBeenCalled();
	await userEvent
		.setup()
		.press(
			screen.getByRole("button", { name: "Approve Gmail: search messages" }),
		);
	expect(onAnswer).toHaveBeenCalledWith("call", true);
});

test("readonly history has no execution controls", async () => {
	await render(<ToolCalls parts={[part]} />);
	expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
	expect(screen.queryByRole("button", { name: /Decline/ })).toBeNull();
});

test("busy requests cannot be answered again", async () => {
	const onAnswer = jest.fn();
	await render(<ToolCalls parts={[part]} busy onAnswer={onAnswer} />);
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: /Decline/ }));
	expect(onAnswer).not.toHaveBeenCalled();
});

test("saved results can be expanded", async () => {
	await render(
		<ToolCalls
			parts={[
				{
					...part,
					state: "output-available",
					output: { subject: "Demo result" },
				},
			]}
		/>,
	);
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Show tool result" }));
	expect(screen.getByText(/Demo result/)).toBeVisible();
});
