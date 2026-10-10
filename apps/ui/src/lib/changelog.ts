export const changelogTags = [
	"llmgateway",
	"devpass",
	"lounge",
	"airside",
] as const;

export type ChangelogTag = (typeof changelogTags)[number];

export const changelogProducts: Record<
	ChangelogTag,
	{ name: string; description: string }
> = {
	llmgateway: {
		name: "LLM Gateway",
		description:
			"API, routing, model access, and dashboard updates for LLM Gateway.",
	},
	devpass: {
		name: "DevPass",
		description:
			"Coding plans, agent integrations, and account updates for DevPass.",
	},
	lounge: {
		name: "Lounge",
		description: "Chat, image, video, and audio studio updates for Lounge.",
	},
	airside: {
		name: "Airside",
		description:
			"Provider listings, model verification, and carrier console updates for Airside.",
	},
};

export const changelogPageSize = 10;

export function isChangelogTag(tag: string): tag is ChangelogTag {
	return changelogTags.some((value) => value === tag);
}

export function changelogPath(tag?: ChangelogTag, page = 1) {
	const path = tag ? (`/changelog/tag/${tag}` as const) : "/changelog";
	return page > 1 ? (`${path}?page=${page}` as const) : path;
}
