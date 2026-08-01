import { LoungeProfileClient } from "@/components/lounge/profile-client";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "My Profile",
	description:
		"Your Lounge membership profile: points, level, streaks, and leaderboard standing.",
	robots: { index: false },
};

export default function LoungeProfilePage() {
	return <LoungeProfileClient />;
}
