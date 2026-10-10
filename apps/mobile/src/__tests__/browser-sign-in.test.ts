import {
	completeBrowserSignIn,
	startBrowserSignIn,
} from "@/auth/browser-sign-in";
import { acceptSession, auth, discardSession } from "@/auth/session";
import { config } from "@/config";
import NativeLoungeAuth from "@/native/NativeLoungeAuth";

import type { BrowserSignInRequest } from "@/auth/browser-sign-in";

jest.mock("@/auth/session", () => ({
	auth: { device: { code: jest.fn(), token: jest.fn() } },
	acceptSession: jest.fn(),
	discardSession: jest.fn(),
}));
jest.mock("@/native/NativeLoungeAuth", () => ({
	open: jest.fn(),
	cancel: jest.fn(),
}));
jest.useFakeTimers();

const fixture = {
	device_code: "fixture-device-code",
	user_code: "DEMO1234",
	verification_uri: `${config.accountUrl}/connect/device`,
	verification_uri_complete: `${config.accountUrl}/connect/device?user_code=DEMO1234`,
	expires_in: 600,
	interval: 5,
};
const token = {
	data: {
		access_token: "fixture-session",
		token_type: "Bearer",
		expires_in: 3600,
		scope: "",
	},
	error: null,
};
let rejectBrowser: (reason: unknown) => void;
let resolveBrowser: (value: string) => void;
const request = (): BrowserSignInRequest => ({
	deviceCode: fixture.device_code,
	userCode: fixture.user_code,
	verificationUrl: fixture.verification_uri_complete,
	expiresAt: Date.now() + 600000,
	intervalMs: 5000,
});
const finish = (value = request(), signal = new AbortController().signal) =>
	completeBrowserSignIn(value, signal).then(
		(value) => ({ token: value }),
		(error: Error) => ({ error: error.message }),
	);
function pending(
	error:
		| "authorization_pending"
		| "slow_down"
		| "access_denied"
		| "expired_token"
		| "invalid_grant",
) {
	return {
		data: null,
		error: {
			error,
			error_description: error,
			status: 400,
			statusText: "Bad Request",
		},
	};
}
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(auth.device.code)
		.mockResolvedValue({ data: fixture, error: null });
	jest.mocked(auth.device.token).mockResolvedValue(token);
	jest.mocked(acceptSession).mockResolvedValue("fixture-session");
	jest.mocked(discardSession).mockResolvedValue(undefined);
	jest.mocked(NativeLoungeAuth.open).mockImplementation(
		() =>
			new Promise((resolve, reject) => {
				resolveBrowser = resolve;
				rejectBrowser = reject;
			}),
	);
	jest
		.mocked(NativeLoungeAuth.cancel)
		.mockImplementation(() => rejectBrowser(new Error("Sign-in cancelled.")));
});
afterEach(() => jest.clearAllTimers());

test("requests a short-lived code for the native client without opening a browser", async () => {
	const controller = new AbortController();
	expect(await startBrowserSignIn(controller.signal)).toEqual(request());
	expect(auth.device.code).toHaveBeenCalledWith(
		{ client_id: "llmgateway-lounge-ios" },
		{ signal: controller.signal },
	);
	expect(NativeLoungeAuth.open).not.toHaveBeenCalled();
});

test.each([
	"https://unexpected.example/connect/device?user_code=DEMO1234",
	`${config.accountUrl}/login?user_code=DEMO1234`,
	`${fixture.verification_uri_complete}#unexpected`,
	`${fixture.verification_uri_complete}&user_code=DEMO1234`,
	`${config.accountUrl}/connect/device?user_code=OTHER123`,
])("rejects an unexpected verification address: %s", async (url) => {
	jest.mocked(auth.device.code).mockResolvedValue({
		data: { ...fixture, verification_uri_complete: url },
		error: null,
	});
	await expect(
		startBrowserSignIn(new AbortController().signal),
	).rejects.toThrow("address is invalid");
	expect(NativeLoungeAuth.open).not.toHaveBeenCalled();
});

test("waits for the polling interval and explicit approval before saving", async () => {
	jest
		.mocked(auth.device.token)
		.mockResolvedValueOnce(pending("authorization_pending"))
		.mockResolvedValueOnce(token);
	const result = finish();
	await jest.advanceTimersByTimeAsync(4999);
	expect(auth.device.token).not.toHaveBeenCalled();
	await jest.advanceTimersByTimeAsync(1);
	expect(acceptSession).not.toHaveBeenCalled();
	await jest.advanceTimersByTimeAsync(5000);
	expect(await result).toEqual({ token: "fixture-session" });
	expect(NativeLoungeAuth.cancel).toHaveBeenCalledTimes(1);
	expect(acceptSession).toHaveBeenCalledWith(
		"fixture-session",
		expect.any(AbortSignal),
	);
	expect(discardSession).not.toHaveBeenCalled();
});

test("increases the interval after a server slow-down response", async () => {
	jest
		.mocked(auth.device.token)
		.mockResolvedValueOnce(pending("slow_down"))
		.mockResolvedValueOnce(token);
	const result = finish();
	await jest.advanceTimersByTimeAsync(14999);
	expect(auth.device.token).toHaveBeenCalledTimes(1);
	await jest.advanceTimersByTimeAsync(1);
	expect(await result).toEqual({ token: "fixture-session" });
});

test.each([
	["access_denied", "declined"],
	["expired_token", "expired"],
	["invalid_grant", "could not finish"],
] as const)(
	"closes the browser without a session for %s",
	async (code, message) => {
		jest.mocked(auth.device.token).mockResolvedValue(pending(code));
		const result = finish();
		await jest.advanceTimersByTimeAsync(5000);
		expect(await result).toEqual({ error: expect.stringContaining(message) });
		expect(acceptSession).not.toHaveBeenCalled();
		expect(NativeLoungeAuth.cancel).toHaveBeenCalledTimes(1);
	},
);

test("expires locally while the browser is open", async () => {
	const result = finish({ ...request(), expiresAt: Date.now() + 1000 });
	await jest.advanceTimersByTimeAsync(1000);
	expect(await result).toEqual({ error: expect.stringContaining("expired") });
	expect(auth.device.token).not.toHaveBeenCalled();
});

test("cancelling the browser stops polling and never signs in", async () => {
	const result = finish();
	rejectBrowser(new Error("Sign-in cancelled."));
	expect(await result).toEqual({ error: "Sign-in cancelled." });
	await jest.advanceTimersByTimeAsync(10000);
	expect(auth.device.token).not.toHaveBeenCalled();
	expect(acceptSession).not.toHaveBeenCalled();
});

test("a browser callback cannot supply a session", async () => {
	const result = finish();
	resolveBrowser("io.llmgateway.lounge://login?token=untrusted");
	expect(await result).toEqual({ error: expect.stringContaining("closed") });
	expect(acceptSession).not.toHaveBeenCalled();
});

test("revokes a late token if cancellation races with the response", async () => {
	let issue: (value: typeof token) => void = () => {
		throw new Error("Polling did not start");
	};
	jest.mocked(auth.device.token).mockImplementation(
		() =>
			new Promise((resolve) => {
				issue = resolve;
			}),
	);
	const controller = new AbortController();
	const result = finish(request(), controller.signal);
	await jest.advanceTimersByTimeAsync(5000);
	controller.abort(new Error("Sign-in cancelled."));
	issue(token);
	expect(await result).toEqual({ error: "Sign-in cancelled." });
	expect(acceptSession).not.toHaveBeenCalled();
	expect(discardSession).toHaveBeenCalledWith("fixture-session");
});

test("revokes an approved token if secure storage fails", async () => {
	jest
		.mocked(acceptSession)
		.mockRejectedValue(new Error("Secure storage unavailable"));
	const result = finish();
	await jest.advanceTimersByTimeAsync(5000);
	expect(await result).toEqual({ error: "Secure storage unavailable" });
	expect(discardSession).toHaveBeenCalledWith("fixture-session");
});

test("does not cancel another native browser session when opening is rejected", async () => {
	jest
		.mocked(NativeLoungeAuth.open)
		.mockRejectedValue(
			Object.assign(new Error("Browser busy"), { code: "AUTH_BUSY" }),
		);
	expect(await finish()).toEqual({ error: "Browser busy" });
	expect(NativeLoungeAuth.cancel).not.toHaveBeenCalled();
});
