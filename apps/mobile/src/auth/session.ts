import { createAuthClient } from "better-auth/client";
import * as Keychain from "react-native-keychain";

import { getSessionToken, queryClient, setSessionToken } from "@/api/client";
import { clearGatewayKey } from "@/api/completion";
import { config } from "@/config";
import { clearPreferences } from "@/lib/preferences";

const service = "io.llmgateway.lounge.session";
export const auth = createAuthClient({
	baseURL: `${config.apiUrl}/auth`,
	fetchOptions: {
		credentials: "omit",
		auth: { type: "Bearer", token: () => getSessionToken() ?? "" },
	},
});

export async function restoreSession() {
	const credentials = await Keychain.getGenericPassword({ service });
	setSessionToken(credentials ? credentials.password : null);
	return credentials ? credentials.password : null;
}

export async function signIn(email: string, password: string) {
	const result = await auth.signIn.email({ email: email.trim(), password });
	if (result.error) {
		throw new Error(result.error.message ?? "Sign-in failed.");
	}
	if (!result.data.token) {
		throw new Error("The server did not return a session.");
	}
	await Keychain.setGenericPassword("session", result.data.token, {
		service,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});
	setSessionToken(result.data.token);
	return result.data.token;
}

export async function signOut() {
	const result = await auth.signOut();
	if (result.error) {
		throw new Error(result.error.message ?? "Could not sign out. Try again.");
	}
	await clearSession();
}

export async function clearSession() {
	await clearPreferences();
	await Keychain.resetGenericPassword({ service });
	setSessionToken(null);
	clearGatewayKey();
	queryClient.clear();
}
