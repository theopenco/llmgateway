import { isPublicIp } from "@/lib/client-ip.js";
import { getCountryFromHeaders } from "@/utils/request-country.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Fallback geo lookup for the client IP, used only when the load balancer did
// not attach a country header (see request-country.ts), the blocklist is
// non-empty, and the IP is public. Any provider returning `country_code` /
// `countryCode` / `country` as an ISO 3166-1 alpha-2 code works; setting
// IP_COUNTRY_LOOKUP_URL to an empty string disables the fallback entirely.
const DEFAULT_IP_COUNTRY_LOOKUP_URL = "https://ipapi.co/{ip}/json/";
const LOOKUP_TIMEOUT_MS = 2000;
const COUNTRY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const UNKNOWN_COUNTRY_CACHE_TTL_SECONDS = 60 * 60;
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

/**
 * Country of the request: the load balancer's own geo header when it has one
 * (GCP's `X-Client-Geo-Location`, Cloudflare's `CF-IPCountry`), otherwise a
 * cached geo lookup on the client IP. Null when it cannot be determined.
 */
export async function resolveRequestCountry(
	headers: Headers | null | undefined,
	ip: string | null | undefined,
): Promise<string | null> {
	return getCountryFromHeaders(headers) ?? (await resolveCountryFromIp(ip));
}

export function getIpCountryCacheKey(ip: string): string {
	return `ip_country:${ip.trim().toLowerCase()}`;
}

function parseCountry(payload: unknown): string | null {
	if (typeof payload === "string") {
		const trimmed = payload.trim().toUpperCase();
		return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
	}
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as Record<string, unknown>;
	for (const key of ["country_code", "countryCode", "country"]) {
		const value = record[key];
		if (typeof value === "string") {
			const country = parseCountry(value);
			if (country) {
				return country;
			}
		}
	}
	return null;
}

function getLookupUrlTemplate(): string {
	return process.env.IP_COUNTRY_LOOKUP_URL ?? DEFAULT_IP_COUNTRY_LOOKUP_URL;
}

async function lookupCountry(
	ip: string,
	template: string,
): Promise<string | null> {
	const url = template.replace("{ip}", encodeURIComponent(ip));

	const response = await fetch(url, {
		signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`IP country lookup failed with status ${response.status}`);
	}

	const text = await response.text();
	try {
		return parseCountry(JSON.parse(text));
	} catch {
		return parseCountry(text);
	}
}

/**
 * Resolves the country of a client IP via a geo lookup, cached in Redis.
 * Returns null when the country cannot be determined (private IP, lookup
 * failure, unknown country) so callers fail open.
 */
export async function resolveCountryFromIp(
	ip: string | null | undefined,
): Promise<string | null> {
	const template = getLookupUrlTemplate();
	if (!ip || !template || !isPublicIp(ip)) {
		return null;
	}

	const cacheKey = getIpCountryCacheKey(ip);
	try {
		const cached = await redisClient.get(cacheKey);
		if (cached) {
			return cached === UNKNOWN_COUNTRY ? null : cached;
		}
	} catch (error) {
		logger.warn("IP country cache read failed", { error });
	}

	let country: string | null = null;
	try {
		country = await lookupCountry(ip, template);
	} catch (error) {
		logger.warn("IP country lookup failed", { error });
		return null;
	}

	try {
		await redisClient.set(
			cacheKey,
			country ?? UNKNOWN_COUNTRY,
			"EX",
			country ? COUNTRY_CACHE_TTL_SECONDS : UNKNOWN_COUNTRY_CACHE_TTL_SECONDS,
		);
	} catch (error) {
		logger.warn("IP country cache write failed", { error });
	}

	return country;
}
