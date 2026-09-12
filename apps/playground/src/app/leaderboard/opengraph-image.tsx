import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Lounge leaderboard — the most active members";
export const size = ogSize;
export const contentType = ogContentType;

export default function LeaderboardOgImage() {
	return loungeOgImage({
		eyebrow: "Leaderboard",
		title: "The most active members of the Lounge",
		subtitle:
			"Ranked by points earned chatting and creating across every frontier model.",
		path: "/leaderboard",
	});
}
