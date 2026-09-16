import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auth, signIn } from "@/auth/session";
import { config } from "@/config";
import { SignIn } from "@/screens/SignIn";

jest.mock("../auth/session", () => ({
	signIn: jest.fn(),
	auth: { signUp: { email: jest.fn() }, requestPasswordReset: jest.fn() },
}));
jest.useFakeTimers();
beforeEach(() => jest.resetAllMocks());

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

test("validates signup and asks for email verification before sign-in", async () => {
	(auth.signUp.email as jest.Mock).mockResolvedValue({ error: null });
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Create an account" }));
	await user.type(screen.getByLabelText("Name"), "  New member  ");
	await user.type(screen.getByLabelText("Email"), "member@example.test");
	await user.type(screen.getByLabelText("Password"), "short");
	expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
	await user.clear(screen.getByLabelText("Password"));
	await user.type(screen.getByLabelText("Password"), "a-long-demo-password");
	await user.press(screen.getByRole("button", { name: "Create account" }));
	expect(auth.signUp.email).toHaveBeenCalledWith({
		name: "New member",
		email: "member@example.test",
		password: "a-long-demo-password",
		callbackURL: config.webUrl,
	});
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Check your email to verify your account, then sign in.",
	);
	expect(
		screen.getByRole("button", { name: "Enter the Lounge" }),
	).toBeOnTheScreen();
	expect(onSignedIn).not.toHaveBeenCalled();
});

test("retains signup fields when registration fails", async () => {
	(auth.signUp.email as jest.Mock).mockResolvedValue({
		error: { message: "Could not create your account." },
	});
	await renderSignIn();
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Create an account" }));
	await user.type(screen.getByLabelText("Name"), "New member");
	await user.type(screen.getByLabelText("Email"), "member@example.test");
	await user.type(screen.getByLabelText("Password"), "a-long-demo-password");
	await user.press(screen.getByRole("button", { name: "Create account" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Could not create your account.",
	);
	expect(screen.getByLabelText("Email")).toHaveDisplayValue(
		"member@example.test",
	);
	expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});

test("requests a reset on the configured account website without revealing account existence", async () => {
	(auth.requestPasswordReset as jest.Mock).mockResolvedValue({ error: null });
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Forgot password?" }));
	expect(screen.queryByLabelText("Password")).not.toBeOnTheScreen();
	await user.type(screen.getByLabelText("Email"), "member@example.test");
	await user.press(screen.getByRole("button", { name: "Send reset link" }));
	expect(auth.requestPasswordReset).toHaveBeenCalledWith({
		email: "member@example.test",
		redirectTo: `${config.accountUrl}/reset-password`,
	});
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"If an account exists for this email, you will receive a password reset link.",
	);
	expect(onSignedIn).not.toHaveBeenCalled();
	await user.press(screen.getByRole("button", { name: "Back to sign in" }));
	expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
});

test("shows reset delivery failures so a user can retry", async () => {
	(auth.requestPasswordReset as jest.Mock).mockResolvedValue({
		error: { message: "Could not send the reset email." },
	});
	await renderSignIn();
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Forgot password?" }));
	await user.type(screen.getByLabelText("Email"), "member@example.test");
	await user.press(screen.getByRole("button", { name: "Send reset link" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Could not send the reset email.",
	);
	expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
});
