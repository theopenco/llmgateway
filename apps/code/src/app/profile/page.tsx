import { redirect } from "next/navigation";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { fetchServerData } from "@/lib/server-api";

import { ProfilePageClient } from "./ProfilePageClient";

import type { paths } from "@/lib/api/v1";
import type { Metadata } from "next";

type ProfileResponse =
	paths["/user/profile"]["get"]["responses"][200]["content"]["application/json"];
type UserMeResponse =
	paths["/user/me"]["get"]["responses"][200]["content"]["application/json"];

export const metadata: Metadata = {
	title: "Your Profile · DevPass",
	robots: { index: false, follow: false },
};

export default async function ProfilePage() {
	const [profileData, userData] = await Promise.all([
		fetchServerData<ProfileResponse>("GET", "/user/profile"),
		fetchServerData<UserMeResponse>("GET", "/user/me"),
	]);

	if (!userData?.user) {
		redirect("/login?returnUrl=/profile");
	}

	return (
		<div className="min-h-screen bg-background">
			<Header />
			<main className="container mx-auto px-4 py-10 sm:py-14">
				<ProfilePageClient
					initialProfile={profileData?.profile ?? null}
					initialUser={userData.user}
				/>
			</main>
			<Footer />
		</div>
	);
}
