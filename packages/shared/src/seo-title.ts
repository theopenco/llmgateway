export const MAX_TITLE_LENGTH = 60;

export type FittedTitle = string | { absolute: string };

/**
 * Returns a Next.js metadata title that stays within the length search
 * results show. The layout template appends the brand suffix; when the page
 * title already names the brand, or the suffix would push it past the limit,
 * the title is emitted as-is instead.
 */
export function fitTitle(
	title: string,
	suffix: string,
	brands: readonly string[],
): FittedTitle {
	if (
		brands.some((brand) => title.includes(brand)) ||
		title.length + suffix.length > MAX_TITLE_LENGTH
	) {
		return { absolute: title };
	}
	return title;
}
