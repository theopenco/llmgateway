/**
 * Display-timezone preference. Stored in a cookie (not the database, not
 * localStorage) so server components can read it with `cookies()` and render
 * the correct value on first paint — see the SSR guideline for user settings
 * that aren't persisted server-side.
 *
 * Stored data is always UTC. This only decides how instants are presented and
 * which zone analytics endpoints bucket by.
 */

export const TIMEZONE_COOKIE_NAME = "llmgateway-timezone";
export const TIMEZONE_COOKIE_MAX_AGE_DAYS = 365;

export const UTC_TIME_ZONE = "UTC";

export type TimeZoneMode = "local" | "utc";

export interface TimeZonePreference {
	mode: TimeZoneMode;
	/** Effective IANA zone to bucket and render in. Always "UTC" in utc mode. */
	timeZone: string;
}

/** No cookie yet: match the historical behaviour of the analytics charts,
 *  which always bucketed by the browser's zone. The real zone is unknown until
 *  the client boots, so the server renders UTC and the bootstrap corrects it. */
export const DEFAULT_TIME_ZONE_PREFERENCE: TimeZonePreference = {
	mode: "local",
	timeZone: UTC_TIME_ZONE,
};

export function isValidTimeZone(timeZone: string): boolean {
	try {
		Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

export function getBrowserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC_TIME_ZONE;
	} catch {
		return UTC_TIME_ZONE;
	}
}

/** Cookie value: `utc`, or `local:<IANA zone>`. The zone is stored alongside
 *  the mode (rather than re-detected) because the server has no way to detect
 *  it — no browser sends the zone in a request header. */
export function serializeTimeZonePreference(
	preference: TimeZonePreference,
): string {
	return preference.mode === "utc"
		? "utc"
		: `local:${preference.timeZone || UTC_TIME_ZONE}`;
}

export function parseTimeZoneCookie(
	raw: string | null | undefined,
): TimeZonePreference {
	if (!raw) {
		return DEFAULT_TIME_ZONE_PREFERENCE;
	}
	if (raw === "utc") {
		return { mode: "utc", timeZone: UTC_TIME_ZONE };
	}
	if (raw.startsWith("local:")) {
		const timeZone = raw.slice("local:".length);
		// A stale or hand-edited cookie must never reach Intl or the analytics
		// query param, both of which throw on an unknown zone.
		if (timeZone.length <= 64 && isValidTimeZone(timeZone)) {
			return { mode: "local", timeZone };
		}
	}
	return DEFAULT_TIME_ZONE_PREFERENCE;
}
