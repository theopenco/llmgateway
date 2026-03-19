import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { useMemo } from "react";

import { useAppConfig } from "./config";

export function useAuthClient() {
	const config = useAppConfig();

	return useMemo(() => {
		return createAuthClient({
			baseURL: config.apiUrl + "/auth",
			plugins: [passkeyClient()],
		});
	}, [config.apiUrl]);
}

export function useAuth() {
	const authClient = useAuthClient();

	return useMemo(
		() => ({
			signIn: authClient.signIn,
			signUp: authClient.signUp,
			signOut: authClient.signOut,
			useSession: authClient.useSession,
			getSession: authClient.getSession,
		}),
		[authClient],
	);
}
