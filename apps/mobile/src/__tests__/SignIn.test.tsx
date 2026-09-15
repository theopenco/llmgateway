import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { signIn } from "@/auth/session";
import { SignIn } from "@/screens/SignIn";

jest.mock("../auth/session", () => ({
	signIn: jest.fn(),
	auth: { signUp: { email: jest.fn() }, requestPasswordReset: jest.fn() },
}));
jest.useFakeTimers();

async function renderSignIn(onSignedIn = jest.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	await render(
		<SafeAreaProvider
			initialMetrics={{
				frame: { x: 0, y: 0, width: 400, height: 850 },
				insets: { top: 60, bottom: 30, left: 0, right: 0 },
			}}
		>
			<QueryClientProvider client={queryClient}>
				<SignIn onSignedIn={onSignedIn} />
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	return onSignedIn;
}

test("requires credentials and completes a successful sign-in", async () => {
	jest.mocked(signIn).mockResolvedValue("fixture-session");
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	expect(
		screen.getByRole("button", { name: "Enter the Lounge" }),
	).toBeDisabled();
	await user.type(screen.getByLabelText("Email"), "admin@example.com");
	await user.type(screen.getByLabelText("Password"), "admin@example.com");
	await user.press(screen.getByRole("button", { name: "Enter the Lounge" }));
	expect(signIn).toHaveBeenCalledWith("admin@example.com", "admin@example.com");
	await waitFor(() =>
		expect(onSignedIn).toHaveBeenCalledWith("fixture-session"),
	);
});

test("shows a sign-in failure without leaving the screen", async () => {
	jest.mocked(signIn).mockRejectedValue(new Error("Invalid email or password"));
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Email"), "admin@example.com");
	await user.type(screen.getByLabelText("Password"), "incorrect");
	await user.press(screen.getByRole("button", { name: "Enter the Lounge" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Invalid email or password",
	);
	expect(onSignedIn).not.toHaveBeenCalled();
});
