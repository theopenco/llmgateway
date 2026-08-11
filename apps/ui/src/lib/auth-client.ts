import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { multiSessionClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useMemo } from "react";

import { useAppConfig } from "./config";

// React hook to get the auth client
export function useAuthClient() {
	const config = useAppConfig();

	return useMemo(() => {
		return createAuthClient({
			baseURL: config.apiUrl + "/auth",
			plugins: [passkeyClient(), ssoClient(), multiSessionClient()],
		});
	}, [config.apiUrl]);
}

// React hook for auth methods
export function useAuth() {
	const authClient = useAuthClient();

	return useMemo(
		() => ({
			signIn: authClient.signIn,
			signUp: authClient.signUp,
			signOut: authClient.signOut,
			useSession: authClient.useSession,
			getSession: authClient.getSession,
			sendVerificationEmail: authClient.sendVerificationEmail,
			multiSession: authClient.multiSession,
		}),
		[authClient],
	);
}
