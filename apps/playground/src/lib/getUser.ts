import PostHogClient from "@/app/posthog";
import { fetchServerData } from "@/lib/server-api";

import type { User } from "better-auth/types";

interface GetUserOptions {
	signal?: AbortSignal;
}

export async function getUser(options?: GetUserOptions) {
	const posthog = PostHogClient();

	const data = await fetchServerData<{ user: User }>("GET", "/user/me", {
		signal: options?.signal,
	});
	const user = data?.user;

	if (!user) {
		return null;
	}

	if (posthog && user.id) {
		posthog.identify({
			distinctId: user.id,
			properties: {
				email: user.email,
				name: user.name,
			},
		});
	}

	return user;
}
