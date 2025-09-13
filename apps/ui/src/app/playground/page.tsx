import { UserProvider } from "@/components/providers/user-provider";
import { fetchServerData } from "@/lib/server-api";

import { PlaygroundClient } from "./playground-client";

import type { User } from "@/lib/types";

// Force dynamic rendering since this page uses server-side data fetching with cookies
export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
	const initialUserData = await fetchServerData<{ user: User }>(
		"GET",
		"/user/me",
	);

	return (
		<UserProvider initialUserData={initialUserData}>
			<PlaygroundClient />
		</UserProvider>
	);
}
