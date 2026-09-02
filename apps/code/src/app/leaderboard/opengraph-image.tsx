import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "DevPass leaderboard — developers ranked by tokens routed";
export const size = ogSize;
export const contentType = ogContentType;

export default function LeaderboardOgImage() {
	return devpassOgImage({
		eyebrow: "Leaderboard",
		title: "The most prolific developers on DevPass",
		subtitle:
			"Ranked by tokens routed through one key — make your profile public to claim your spot.",
		path: "/leaderboard",
	});
}
