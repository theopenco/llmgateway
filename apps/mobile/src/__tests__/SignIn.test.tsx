import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
	startBrowserSignIn,
	completeBrowserSignIn,
} from "@/auth/browser-sign-in";
import { auth, signIn } from "@/auth/session";
import { config } from "@/config";
import { SignIn } from "@/screens/SignIn";

jest.mock("../auth/session", () => ({
	signIn: jest.fn(),
	auth: { signUp: { email: jest.fn() }, requestPasswordReset: jest.fn() },
}));
jest.mock("@/auth/browser-sign-in", () => ({
	startBrowserSignIn: jest.fn(),
	completeBrowserSignIn: jest.fn(),
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

test("shows the matching code before opening the browser and can cancel", async () => {
	jest.mocked(startBrowserSignIn).mockResolvedValue({
		deviceCode: "fixture",
		userCode: "DEMO1234",
		verificationUrl: `${config.accountUrl}/connect/device?user_code=DEMO1234`,
		expiresAt: Date.now() + 600000,
		intervalMs: 5000,
	});
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Sign in with browser" }),
	);
	expect(
		await screen.findByLabelText("Sign-in code: DEMO1234"),
	).toBeOnTheScreen();
	expect(completeBrowserSignIn).not.toHaveBeenCalled();
	await user.press(screen.getByRole("button", { name: "Cancel sign-in" }));
	expect(jest.mocked(startBrowserSignIn).mock.calls[0][0].aborted).toBe(true);
	expect(
		screen.getByRole("button", { name: "Enter the Lounge" }),
	).toBeOnTheScreen();
	expect(onSignedIn).not.toHaveBeenCalled();
});

test("reports browser setup failures without hiding email sign-in", async () => {
	jest
		.mocked(startBrowserSignIn)
		.mockRejectedValue(new Error("Browser sign-in unavailable"));
	await renderSignIn();
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Sign in with browser" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Browser sign-in unavailable",
	);
	expect(screen.getByLabelText("Email")).toBeOnTheScreen();
});

test("opens the browser only on confirmation and returns the approved session", async () => {
	const request = {
		deviceCode: "fixture",
		userCode: "DEMO1234",
		verificationUrl: `${config.accountUrl}/connect/device?user_code=DEMO1234`,
		expiresAt: Date.now() + 600000,
		intervalMs: 5000,
	};
	jest.mocked(startBrowserSignIn).mockResolvedValue(request);
	jest.mocked(completeBrowserSignIn).mockResolvedValue("fixture-session");
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Sign in with browser" }),
	);
	await user.press(
		await screen.findByRole("button", { name: "Continue in browser" }),
	);
	await waitFor(() =>
		expect(onSignedIn).toHaveBeenCalledWith("fixture-session"),
	);
	expect(completeBrowserSignIn).toHaveBeenCalledWith(
		request,
		expect.any(AbortSignal),
	);
});

test("offers a new code after a declined browser sign-in", async () => {
	const request = {
		deviceCode: "fixture",
		userCode: "DEMO1234",
		verificationUrl: `${config.accountUrl}/connect/device?user_code=DEMO1234`,
		expiresAt: Date.now() + 600000,
		intervalMs: 5000,
	};
	jest
		.mocked(startBrowserSignIn)
		.mockResolvedValueOnce(request)
		.mockResolvedValueOnce({ ...request, userCode: "NEXT1234" });
	jest
		.mocked(completeBrowserSignIn)
		.mockRejectedValue(new Error("You declined this sign-in request."));
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Sign in with browser" }),
	);
	await user.press(
		await screen.findByRole("button", { name: "Continue in browser" }),
	);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"You declined this sign-in request.",
	);
	await user.press(screen.getByRole("button", { name: "Get a new code" }));
	expect(
		await screen.findByLabelText("Sign-in code: NEXT1234"),
	).toBeOnTheScreen();
	expect(jest.mocked(startBrowserSignIn).mock.calls[0][0].aborted).toBe(true);
	expect(onSignedIn).not.toHaveBeenCalled();
});

test("aborts a browser sign-in when its screen unmounts", async () => {
	jest.mocked(startBrowserSignIn).mockResolvedValue({
		deviceCode: "fixture",
		userCode: "DEMO1234",
		verificationUrl: `${config.accountUrl}/connect/device?user_code=DEMO1234`,
		expiresAt: Date.now() + 600000,
		intervalMs: 5000,
	});
	jest.mocked(completeBrowserSignIn).mockImplementation(
		(_request, signal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => reject(new Error("Sign-in cancelled.")),
					{ once: true },
				);
			}),
	);
	const onSignedIn = await renderSignIn();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Sign in with browser" }),
	);
	await user.press(
		await screen.findByRole("button", { name: "Continue in browser" }),
	);
	await screen.unmount();
	expect(jest.mocked(completeBrowserSignIn).mock.calls[0][1].aborted).toBe(
		true,
	);
	expect(onSignedIn).not.toHaveBeenCalled();
});
