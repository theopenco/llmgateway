import PostHogClient from "@/app/posthog";
import { fetchServerData } from "@/lib/server-api";

import type { User } from "better-auth/types";

export async function getUser() {
	const posthog = PostHogClient();

	const data = await fetchServerData<{ user: User }>("GET", "/user/me");
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
