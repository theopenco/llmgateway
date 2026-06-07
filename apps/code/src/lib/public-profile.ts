import { getConfig } from "@/lib/config-server";

import type { ProfileData } from "@/components/profile/ProfileView";

/**
 * Fetch a public DevPass profile by username from the API. Returns null when
 * the profile does not exist or is private. Used by the public profile page
 * and its dynamic OG image.
 */
export async function fetchPublicProfile(
	username: string,
): Promise<ProfileData | null> {
	const config = getConfig();
	try {
		const res = await fetch(
			`${config.apiBackendUrl}/public/profile/${encodeURIComponent(username)}`,
			{ next: { revalidate: 60 } },
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as { profile: ProfileData };
		return json.profile;
	} catch {
		return null;
	}
}
