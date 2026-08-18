import { db, tables } from "@llmgateway/db";

const UNKNOWN_COUNTRY = "XX";

/** Admin-configurable blocklist, edited in the admin dashboard settings. */
export const BLOCKED_SIGNUP_COUNTRIES_SETTING_ID = "blocked_signup_countries";

/** Normalizes free-form input into a deduped list of alpha-2 country codes. */
export function normalizeCountryCodes(input: string | string[]): string[] {
	const codes = Array.isArray(input) ? input : input.split(",");
	const normalized = codes
		.map((code) => code.trim().toUpperCase())
		.filter((code) => /^[A-Z]{2}$/.test(code) && code !== UNKNOWN_COUNTRY);
	return [...new Set(normalized)];
}

export async function getBlockedSignupCountries(): Promise<string[]> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: BLOCKED_SIGNUP_COUNTRIES_SETTING_ID },
	});
	if (!setting?.enabled || !setting.value) {
		return [];
	}
	return normalizeCountryCodes(setting.value);
}

export async function setBlockedSignupCountries(
	countries: string[],
): Promise<string[]> {
	const normalized = normalizeCountryCodes(countries);
	await db
		.insert(tables.systemSetting)
		.values({
			id: BLOCKED_SIGNUP_COUNTRIES_SETTING_ID,
			enabled: normalized.length > 0,
			value: normalized.join(","),
		})
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: {
				enabled: normalized.length > 0,
				value: normalized.join(","),
				updatedAt: new Date(),
			},
		});
	return normalized;
}

/**
 * Matches an ISO 3166-1 alpha-2 country code against the blocklist. A missing
 * or unknown country never blocks, so requests whose country cannot be
 * resolved are unaffected.
 */
export function isCountryBlocked(
	country: string | null | undefined,
	blockedCountries: string[],
): boolean {
	if (!country) {
		return false;
	}
	const normalized = normalizeCountryCodes([country]);
	return normalized.length > 0 && blockedCountries.includes(normalized[0]!);
}
