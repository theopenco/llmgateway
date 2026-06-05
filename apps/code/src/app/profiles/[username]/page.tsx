import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import {
	ProfileView,
	type ProfileData,
} from "@/components/profile/ProfileView";
import { fetchPublicProfile } from "@/lib/public-profile";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ username: string }>;
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { username } = await params;
	const profile = await fetchPublicProfile(username);

	if (!profile) {
		return { title: "Profile not found · DevPass" };
	}

	const name = profile.name?.trim() || `@${profile.username}`;
	const title = `${name} · DevPass`;
	const description = `${name}'s AI coding activity on DevPass — ${profile.stats.activeDays} active days, ${profile.stats.currentStreak}-day streak.`;

	return {
		title,
		description,
		alternates: { canonical: `/profiles/${profile.username}` },
		openGraph: {
			title,
			description,
			type: "profile",
			url: `/profiles/${profile.username}`,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function PublicProfilePage({ params }: PageProps) {
	const { username } = await params;
	const profile = await fetchPublicProfile(username);

	if (!profile) {
		notFound();
	}

	return (
		<div className="min-h-screen bg-background">
			<Header />
			<main className="container mx-auto px-4 py-10 sm:py-14">
				<ProfileView profile={profile as ProfileData} />
			</main>
			<Footer />
		</div>
	);
}
