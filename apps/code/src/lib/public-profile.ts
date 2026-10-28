import { cache } from "react";

import { getConfig } from "@/lib/config-server";
import { attachCanonicalModels } from "@/lib/model-family";

import type {
	ApiProfileData,
	ProfileData,
} from "@/components/profile/ProfileView";

/**
 * Fetch a public DevPass profile by username from the API. Returns null when
 * the profile does not exist or is private. Used by the public profile page
 * and its dynamic OG image. cache() dedupes the generateMetadata + page
 * calls within a single request.
 */
export const fetchPublicProfile = cache(async function fetchPublicProfile(
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
		const json = (await res.json()) as { profile: ApiProfileData };
		return {
			...json.profile,
			models: attachCanonicalModels(json.profile.models),
		};
	} catch {
		return null;
	}
});
