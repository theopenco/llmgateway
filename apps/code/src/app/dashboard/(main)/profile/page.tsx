import { redirect } from "next/navigation";

import { attachCanonicalModels } from "@/lib/model-family";
import { fetchServerData, getUserMe } from "@/lib/server-api";

import { ProfilePageClient } from "./ProfilePageClient";

import type { paths } from "@/lib/api/v1";
import type { Metadata } from "next";

type ProfileResponse =
	paths["/user/profile"]["get"]["responses"][200]["content"]["application/json"];

export const metadata: Metadata = {
	title: "Your Profile · DevPass",
	robots: { index: false, follow: false },
};

export default async function ProfilePage() {
	const [profileData, userData] = await Promise.all([
		fetchServerData<ProfileResponse>("GET", "/user/profile"),
		getUserMe(),
	]);

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard/profile");
	}

	// Canonical models are resolved here so the client bundle never imports
	// the full model catalogue.
	const profile = profileData?.profile
		? {
				...profileData.profile,
				models: attachCanonicalModels(profileData.profile.models),
			}
		: null;

	return (
		<ProfilePageClient initialProfile={profile} initialUser={userData.user} />
	);
}
