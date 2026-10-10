import * as Keychain from "react-native-keychain";

import { getSessionToken, setSessionToken } from "@/api/client";
import { clearGatewayKey } from "@/api/completion";
import {
	acceptSession,
	auth,
	restoreSession,
	signIn,
	signOut,
} from "@/auth/session";

jest.mock("@/api/completion", () => ({ clearGatewayKey: jest.fn() }));

jest.mock("react-native-keychain", () => ({
	getGenericPassword: jest.fn(),
	setGenericPassword: jest.fn(),
	resetGenericPassword: jest.fn(),
	ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WhenUnlockedThisDeviceOnly" },
	STORAGE_TYPE: { AES_GCM_NO_AUTH: "AES_GCM_NO_AUTH" },
}));
jest.mock("better-auth/client/plugins", () => ({
	deviceAuthorizationClient: jest.fn(),
}));
jest.mock("better-auth/client", () => ({
	createAuthClient: () => ({
		signIn: { email: jest.fn() },
		signOut: jest.fn(),
	}),
}));
jest.mock("../api/client", () => {
	let token: string | null = null;
	return {
		queryClient: { clear: jest.fn() },
		getSessionToken: () => token,
		setSessionToken: (value: string | null) => {
			token = value;
		},
	};
});

beforeEach(() => {
	jest.clearAllMocks();
	setSessionToken(null);
	jest.mocked(Keychain.setGenericPassword).mockReset();
	jest
		.mocked(auth.signOut)
		.mockResolvedValue({ data: { success: true }, error: null });
});

test("restores a credential from device Keychain", async () => {
	jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
		username: "session",
		password: "fixture-session",
		service: "io.llmgateway.lounge.session",
		storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
	});
	expect(await restoreSession()).toBe("fixture-session");
	expect(getSessionToken()).toBe("fixture-session");
});

test("does not authenticate if secure storage fails", async () => {
	jest.mocked(auth.signIn.email).mockResolvedValue({
		data: { token: "fixture-session" },
		error: null,
	} as Awaited<ReturnType<typeof auth.signIn.email>>);
	jest
		.mocked(Keychain.setGenericPassword)
		.mockRejectedValue(new Error("Keychain unavailable"));
	await expect(
		signIn("admin@example.com", "admin@example.com"),
	).rejects.toThrow("Keychain unavailable");
	expect(getSessionToken()).toBeNull();
});

test("keeps the session when server-side sign-out fails", async () => {
	setSessionToken("fixture-session");
	jest.mocked(auth.signOut).mockResolvedValue({
		data: null,
		error: { message: "Offline", status: 503, statusText: "Unavailable" },
	});
	await expect(signOut()).rejects.toThrow("Offline");
	expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
	expect(getSessionToken()).toBe("fixture-session");
});

test("clears gateway credentials when signing out", async () => {
	setSessionToken("fixture-session");
	jest
		.mocked(auth.signOut)
		.mockResolvedValue({ data: { success: true }, error: null });
	jest.mocked(Keychain.resetGenericPassword).mockResolvedValue(true);
	await signOut();
	expect(getSessionToken()).toBeNull();
	expect(clearGatewayKey).toHaveBeenCalledTimes(1);
	expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
		service: "io.llmgateway.lounge.preferences",
	});
	expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
		service: "io.llmgateway.lounge.workspace",
	});
});

test("rejects a false Keychain result and revokes the unused password session", async () => {
	jest.mocked(auth.signIn.email).mockResolvedValue({
		data: { token: "fixture-session" },
		error: null,
	} as Awaited<ReturnType<typeof auth.signIn.email>>);
	jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
	await expect(
		signIn("admin@example.com", "admin@example.com"),
	).rejects.toThrow("saved securely");
	expect(getSessionToken()).toBeNull();
	expect(auth.signOut).toHaveBeenCalledWith({
		fetchOptions: {
			auth: { type: "Bearer", token: "fixture-session" },
			credentials: "omit",
		},
	});
});

test("removes a session saved while sign-in was cancelled", async () => {
	const controller = new AbortController();
	jest.mocked(Keychain.setGenericPassword).mockImplementation(async () => {
		controller.abort(new Error("Sign-in cancelled."));
		return {
			service: "io.llmgateway.lounge.session",
			storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
		};
	});
	await expect(
		acceptSession("fixture-session", controller.signal),
	).rejects.toThrow("cancelled");
	expect(getSessionToken()).toBeNull();
	expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({
		service: "io.llmgateway.lounge.session",
	});
});

test("activates the session only after secure storage succeeds", async () => {
	jest.mocked(Keychain.setGenericPassword).mockImplementation(async () => {
		expect(getSessionToken()).toBeNull();
		return {
			service: "io.llmgateway.lounge.session",
			storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
		};
	});
	expect(await acceptSession("fixture-session")).toBe("fixture-session");
	expect(getSessionToken()).toBe("fixture-session");
});
