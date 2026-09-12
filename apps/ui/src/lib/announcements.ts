import type { AnnouncementEntry } from "@/components/dashboard/changelog-notifications";
import type { Blog, Changelog } from "content-collections";

let cached: AnnouncementEntry[] | null = null;

// Content collections are static per build, so build the notification-bell
// entries once per process instead of on every dashboard request.
export async function getAnnouncementEntries(): Promise<AnnouncementEntry[]> {
	if (cached) {
		return cached;
	}
	try {
		const { allChangelogs, allBlogs } = await import("content-collections");

		const changelogs: AnnouncementEntry[] = allChangelogs
			.filter((entry: Changelog) => !entry?.draft)
			.map((entry: Changelog) => ({
				slug: entry.slug,
				title: entry.title,
				summary: entry.summary,
				date: entry.date,
				type: "changelog" as const,
			}));

		const blogs: AnnouncementEntry[] = allBlogs
			.filter((entry: Blog) => !entry?.draft)
			.map((entry: Blog) => ({
				slug: entry.slug,
				title: entry.title,
				summary: entry.summary,
				date: entry.date,
				type: "blog" as const,
			}));

		cached = [...changelogs, ...blogs]
			.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
			.slice(0, 8);
	} catch {
		// Content collections may not be available during build
		cached = [];
	}
	return cached;
}
