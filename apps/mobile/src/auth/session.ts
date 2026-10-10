import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import * as Keychain from "react-native-keychain";

import { getSessionToken, queryClient, setSessionToken } from "@/api/client";
import { clearGatewayKey } from "@/api/completion";
import { config } from "@/config";
import { clearCanvasModel } from "@/lib/canvas-model";
import { clearEscapeModel } from "@/lib/escape-model";
import { clearPreferences } from "@/lib/preferences";
import { clearWorkspace } from "@/lib/workspace";

const service = "io.llmgateway.lounge.session";
export const auth = createAuthClient({
	baseURL: `${config.apiUrl}/auth`,
	plugins: [deviceAuthorizationClient()],
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
	try {
		return await acceptSession(result.data.token);
	} catch (error) {
		await discardSession(result.data.token);
		throw error;
	}
}

export async function acceptSession(token: string, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const saved = await Keychain.setGenericPassword("session", token, {
		service,
		accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	});
	if (!saved) {
		throw new Error(
			"Your session could not be saved securely. Please try again.",
		);
	}
	if (signal?.aborted) {
		await Keychain.resetGenericPassword({ service });
		signal.throwIfAborted();
	}
	setSessionToken(token);
	return token;
}

export async function discardSession(token: string) {
	const result = await auth.signOut({
		fetchOptions: { auth: { type: "Bearer", token }, credentials: "omit" },
	});
	if (result.error) {
		throw new Error(
			"The unused sign-in session could not be revoked. Please try again.",
		);
	}
}

export async function signOut() {
	const result = await auth.signOut();
	if (result.error) {
		throw new Error(result.error.message ?? "Could not sign out. Try again.");
	}
	await clearSession();
}

export async function clearSession() {
	await clearWorkspace();
	await clearCanvasModel();
	await clearEscapeModel();
	await clearPreferences();
	await Keychain.resetGenericPassword({ service });
	setSessionToken(null);
	clearGatewayKey();
	queryClient.clear();
}
