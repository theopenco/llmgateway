/**
 * Platform-wide announcement banner, toggled from the admin dashboard and
 * rendered by every public surface (main UI, DevPass, docs, Airside).
 */
export const SYSTEM_BANNER_SEVERITIES = [
	"info",
	"warning",
	"critical",
] as const;

export type SystemBannerSeverity = (typeof SYSTEM_BANNER_SEVERITIES)[number];

export interface SystemBanner {
	message: string;
	severity: SystemBannerSeverity;
	/** Absolute https URL rendered as a button, or null for a text-only banner. */
	linkUrl: string | null;
	linkLabel: string | null;
}

export const SYSTEM_BANNER_MESSAGE_MAX_LENGTH = 280;
export const SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH = 32;
export const SYSTEM_BANNER_DEFAULT_LINK_LABEL = "Learn more";

export function isSystemBannerSeverity(
	value: unknown,
): value is SystemBannerSeverity {
	return SYSTEM_BANNER_SEVERITIES.includes(value as SystemBannerSeverity);
}

/**
 * Banners render on four public sites, so a relative path would resolve
 * differently on each one — only absolute https URLs are accepted.
 */
export function isValidSystemBannerLink(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return parsed.protocol === "https:";
}

function trimToLength(value: string, max: number): string {
	return value.trim().slice(0, max);
}

/** Normalizes admin input, returning null when there is nothing to show. */
export function normalizeSystemBanner(input: {
	message?: string | null;
	severity?: string | null;
	linkUrl?: string | null;
	linkLabel?: string | null;
}): SystemBanner | null {
	const message = trimToLength(
		input.message ?? "",
		SYSTEM_BANNER_MESSAGE_MAX_LENGTH,
	);
	if (!message) {
		return null;
	}
	const linkUrl = input.linkUrl?.trim() || null;
	return {
		message,
		severity: isSystemBannerSeverity(input.severity) ? input.severity : "info",
		linkUrl,
		linkLabel: linkUrl
			? trimToLength(
					input.linkLabel ?? "",
					SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH,
				) || null
			: null,
	};
}

export function serializeSystemBanner(banner: SystemBanner): string {
	return JSON.stringify(banner);
}

export function parseSystemBanner(
	value: string | null | undefined,
): SystemBanner | null {
	if (!value) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}
	return normalizeSystemBanner(parsed as Record<string, string | null>);
}
