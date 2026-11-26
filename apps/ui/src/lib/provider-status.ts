import { cache } from "react";

import { getConfig } from "@/lib/config-server";
import { listedProviders } from "@/lib/providers-catalog";

import type { paths } from "@/lib/api/v1";

export type ProviderStatusDetail =
	paths["/public/providers/status/{providerId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type ProviderStatusList =
	paths["/public/providers/status"]["get"]["responses"]["200"]["content"]["application/json"];
export type OfficialIndicator = NonNullable<
	ProviderStatusList["providers"][number]["official"]
>["indicator"];
export type StatusDay = ProviderStatusDetail["measured"]["days"][number];
export type OfficialIncident = NonNullable<
	ProviderStatusDetail["official"]
>["incidents"][number];

export const STATUS_REVALIDATE_SECONDS = 300;

/** A day with fewer valid requests than this is drawn as "no data". */
export const MIN_DAY_REQUESTS = 100;

/** Listed public providers; the API serves every public provider. */
export const statusProviders = listedProviders;

export function findStatusProvider(providerId: string) {
	return statusProviders.find((provider) => provider.id === providerId);
}

async function getJson<T>(path: string): Promise<T | null> {
	const config = getConfig();
	try {
		const response = await fetch(`${config.apiBackendUrl}${path}`, {
			next: { revalidate: STATUS_REVALIDATE_SECONDS },
		});
		if (!response.ok) {
			console.error(`Failed to fetch ${path}:`, response.status);
			return null;
		}
		return (await response.json()) as T;
	} catch (error) {
		console.error(`Error fetching ${path}:`, error);
		return null;
	}
}

export const fetchProviderStatus = cache(async (providerId: string) => {
	return await getJson<ProviderStatusDetail>(
		`/public/providers/status/${encodeURIComponent(providerId)}`,
	);
});

export const fetchProviderStatusList = cache(async () => {
	return await getJson<ProviderStatusList>("/public/providers/status");
});

export const indicatorLabels: Record<OfficialIndicator, string> = {
	none: "Operational",
	minor: "Minor issues",
	major: "Major outage",
	critical: "Critical outage",
	maintenance: "Maintenance",
};

export const indicatorDotClass: Record<OfficialIndicator, string> = {
	none: "bg-green-500",
	minor: "bg-amber-500",
	major: "bg-orange-500",
	critical: "bg-red-500",
	maintenance: "bg-blue-500",
};

const indicatorRank: Record<OfficialIndicator, number> = {
	none: 0,
	maintenance: 1,
	minor: 2,
	major: 3,
	critical: 4,
};

export function worseIndicator(
	a: OfficialIndicator,
	b: OfficialIndicator,
): OfficialIndicator {
	return indicatorRank[b] > indicatorRank[a] ? b : a;
}

export function hasEnoughDayData(requestCount: number) {
	return requestCount >= MIN_DAY_REQUESTS;
}

export function formatUptime(uptime: number) {
	if (uptime >= 99.995) {
		return "100%";
	}
	return `${uptime.toFixed(2)}%`;
}

export function uptimeTextClass(uptime: number) {
	if (uptime >= 99) {
		return "text-green-600 dark:text-green-400";
	}
	if (uptime >= 95) {
		return "text-amber-600 dark:text-amber-400";
	}
	return "text-red-600 dark:text-red-400";
}

export function dayBarClass(day: StatusDay) {
	if (day.uptime === null || !hasEnoughDayData(day.requestCount)) {
		return "bg-muted";
	}
	if (day.uptime >= 99.5) {
		return "bg-green-500";
	}
	if (day.uptime >= 98) {
		return "bg-lime-500";
	}
	if (day.uptime >= 95) {
		return "bg-amber-500";
	}
	if (day.uptime >= 90) {
		return "bg-orange-500";
	}
	return "bg-red-500";
}

/** Worst official incident impact per UTC day (YYYY-MM-DD). */
export function incidentImpactByDay(
	incidents: OfficialIncident[],
	now: Date = new Date(),
): Map<string, OfficialIndicator> {
	const byDay = new Map<string, OfficialIndicator>();
	const dayMs = 24 * 60 * 60 * 1000;
	for (const incident of incidents) {
		if (incident.impact === "none") {
			continue;
		}
		const start = Date.parse(incident.createdAt);
		const end = incident.resolvedAt
			? Date.parse(incident.resolvedAt)
			: now.getTime();
		if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
			continue;
		}
		const first = Math.floor(start / dayMs);
		const last = Math.min(Math.floor(end / dayMs), first + 30);
		for (let day = first; day <= last; day++) {
			const key = new Date(day * dayMs).toISOString().slice(0, 10);
			byDay.set(key, worseIndicator(byDay.get(key) ?? "none", incident.impact));
		}
	}
	return byDay;
}

export function formatIncidentDuration(incident: OfficialIncident) {
	if (!incident.resolvedAt) {
		return null;
	}
	const minutes = Math.round(
		(Date.parse(incident.resolvedAt) - Date.parse(incident.createdAt)) / 60_000,
	);
	if (!Number.isFinite(minutes) || minutes < 0) {
		return null;
	}
	if (minutes < 60) {
		return `${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
