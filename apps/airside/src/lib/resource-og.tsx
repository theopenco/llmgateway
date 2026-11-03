import { airsideOgImage } from "@/lib/og";
import { RESOURCE_PAGES } from "@/lib/resources";

export function resourceOgImage(path: string) {
	const page = RESOURCE_PAGES.find((entry) => entry.href === path);
	if (!page) {
		throw new Error(`Unknown resource: ${path}`);
	}
	return airsideOgImage({
		eyebrow: path.startsWith("/tools/")
			? "Free provider tool"
			: "Provider guide",
		title: page.title,
		subtitle: page.description,
	});
}

export function resourceOgAlt(path: string) {
	return (
		RESOURCE_PAGES.find((entry) => entry.href === path)?.title ?? "Airside"
	);
}
