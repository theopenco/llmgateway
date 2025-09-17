import { cookies } from "next/headers";

import PostHogClient from "@/app/posthog";
import { getConfig } from "@/lib/config-server";

import type { User } from "better-auth/types";

export async function getUser() {
	const posthog = PostHogClient();
	const config = getConfig();
	const cookieStore = await cookies();

	const key = "better-auth.session_token";
	// Get session cookie for authentication
	const sessionCookie = cookieStore.get(`${key}`);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);

	const data = await fetch(`${config.apiBackendUrl}/user/me`, {
		method: "GET",
		headers: {
			Cookie: secureSessionCookie
				? `__Secure-${key}=${secureSessionCookie.value}`
				: sessionCookie
					? `${key}=${sessionCookie.value}`
					: "",
		},
	});

	if (!data.ok) {
		return null;
	}

	const user: User = await data.json();

	if (posthog) {
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
