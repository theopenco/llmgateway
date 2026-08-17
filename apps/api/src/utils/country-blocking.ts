import ipaddr from "ipaddr.js";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

// Geo lookup for the client IP. Only called when BLOCKED_SIGNUP_COUNTRIES is
// set, and only for public IPs. Any provider returning `country_code` /
// `countryCode` / `country` as an ISO 3166-1 alpha-2 code works.
const DEFAULT_IP_COUNTRY_LOOKUP_URL = "https://ipapi.co/{ip}/json/";
const LOOKUP_TIMEOUT_MS = 2000;
const COUNTRY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const UNKNOWN_COUNTRY_CACHE_TTL_SECONDS = 60 * 60;
const UNKNOWN_COUNTRY = "XX";

export function getBlockedSignupCountries(): string[] {
	return (process.env.BLOCKED_SIGNUP_COUNTRIES ?? "")
		.split(",")
		.map((code) => code.trim().toUpperCase())
		.filter(Boolean);
}

/**
 * Matches an ISO 3166-1 alpha-2 country code against
 * BLOCKED_SIGNUP_COUNTRIES. A missing or unknown country never blocks, so
 * deployments where the country cannot be resolved are unaffected.
 */
export function isSignupCountryBlocked(
	country: string | null | undefined,
): boolean {
	if (!country || country.trim().toUpperCase() === UNKNOWN_COUNTRY) {
		return false;
	}
	return getBlockedSignupCountries().includes(country.trim().toUpperCase());
}

export function getIpCountryCacheKey(ip: string): string {
	return `ip_country:${ip.trim().toLowerCase()}`;
}

function isPublicIp(ip: string): boolean {
	try {
		let parsed = ipaddr.parse(ip);
		if (
			parsed.kind() === "ipv6" &&
			(parsed as ipaddr.IPv6).isIPv4MappedAddress()
		) {
			parsed = (parsed as ipaddr.IPv6).toIPv4Address();
		}
		return parsed.range() === "unicast";
	} catch {
		return false;
	}
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

async function lookupCountry(ip: string): Promise<string | null> {
	const url = (
		process.env.IP_COUNTRY_LOOKUP_URL ?? DEFAULT_IP_COUNTRY_LOOKUP_URL
	).replace("{ip}", encodeURIComponent(ip));

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
	if (!ip || !isPublicIp(ip)) {
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
		country = await lookupCountry(ip);
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
