import PostHogClient from "@/app/posthog";
import { getUserMe } from "@/lib/server-api";

export async function getUser() {
	const posthog = PostHogClient();

	const data = await getUserMe();
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
