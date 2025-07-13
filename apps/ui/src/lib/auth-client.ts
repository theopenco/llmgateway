import { passkeyClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useMemo } from "react";

import { Route } from "@/routes/__root";

// React hook to get the auth client
export function useAuthClient() {
	const config = Route.useLoaderData();

	return useMemo(() => {
		return createAuthClient({
			baseURL: config.apiUrl + "/auth",
			plugins: [passkeyClient()],
		});
	}, [config.apiUrl]);
}

// React hook for auth methods
export function useAuth() {
	const authClient = useAuthClient();

	return {
		signIn: authClient.signIn,
		signUp: authClient.signUp,
		signOut: authClient.signOut,
		useSession: authClient.useSession,
		getSession: authClient.getSession,
		sendVerificationEmail: authClient.sendVerificationEmail,
	};
}
