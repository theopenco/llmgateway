import { z } from "zod";

import { logger } from "@llmgateway/logger";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_COMPONENTS = 24;
const MAX_INCIDENTS = 30;
const INCIDENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export const OFFICIAL_INDICATORS = [
	"none",
	"minor",
	"major",
	"critical",
	"maintenance",
] as const;

export type OfficialIndicator = (typeof OFFICIAL_INDICATORS)[number];

const indicatorSchema = z.enum(OFFICIAL_INDICATORS).catch("none");

const summarySchema = z.object({
	status: z.object({
		indicator: indicatorSchema,
		description: z.string(),
	}),
	components: z
		.array(
			z.object({
				name: z.string(),
				status: z.string(),
				group_id: z.string().nullish(),
				only_show_if_degraded: z.boolean().nullish(),
			}),
		)
		.catch([]),
});

const incidentsSchema = z.object({
	incidents: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			status: z.string(),
			impact: indicatorSchema,
			created_at: z.string(),
			resolved_at: z.string().nullish(),
			shortlink: z.string().nullish(),
		}),
	),
});

export interface OfficialComponent {
	name: string;
	status: string;
}

export interface OfficialIncident {
	id: string;
	name: string;
	status: string;
	impact: OfficialIndicator;
	createdAt: string;
	resolvedAt: string | null;
	url: string;
}

export interface OfficialStatus {
	indicator: OfficialIndicator;
	description: string;
	components: OfficialComponent[];
	incidents: OfficialIncident[];
}

/**
 * The Statuspage v2 JSON API (`/api/v2/summary.json`), which Atlassian
 * Statuspage and incident.io pages both serve. Returns null when the page
 * does not serve it.
 */
export function statusPageApiBase(statusPageUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(statusPageUrl);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.pathname.replace(/\/+$/, "") !== "") {
		return null;
	}
	return `${url.origin}/api/v2`;
}

/** The page answered but does not serve the Statuspage API. */
class UnsupportedStatusPageError extends Error {}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		headers: { Accept: "application/json" },
		redirect: "manual",
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (response.status >= 500 || response.status === 429) {
		throw new Error(`HTTP ${response.status}`);
	}
	if (!response.ok) {
		throw new UnsupportedStatusPageError(`HTTP ${response.status}`);
	}
	if (!response.headers.get("content-type")?.includes("json")) {
		throw new UnsupportedStatusPageError("Not a JSON response");
	}
	return await response.json();
}

function incidentUrl(
	statusPageUrl: string,
	incident: { id: string; shortlink?: string | null },
): string {
	if (incident.shortlink?.startsWith("https://")) {
		return incident.shortlink;
	}
	return `${new URL(statusPageUrl).origin}/incidents/${encodeURIComponent(incident.id)}`;
}

/**
 * Reads a provider's official status page. Only call this with status page
 * URLs from the static provider catalogue: they are trusted, while
 * tenant-supplied URLs must go through the user-content URL guard.
 *
 * Resolves null when the page does not serve the Statuspage API, and rejects
 * on transient failures (network, timeout, 5xx).
 */
export async function fetchOfficialStatus(
	statusPageUrl: string,
	now: Date = new Date(),
): Promise<OfficialStatus | null> {
	const base = statusPageApiBase(statusPageUrl);
	if (!base) {
		return null;
	}
	try {
		const [summaryResult, incidentsResult] = await Promise.allSettled([
			fetchJson(`${base}/summary.json`),
			fetchJson(`${base}/incidents.json`),
		]);
		if (summaryResult.status === "rejected") {
			throw summaryResult.reason;
		}
		let incidentsRaw: unknown = null;
		if (incidentsResult.status === "fulfilled") {
			incidentsRaw = incidentsResult.value;
		} else if (
			!(incidentsResult.reason instanceof UnsupportedStatusPageError)
		) {
			throw incidentsResult.reason;
		}
		const parsedSummary = summarySchema.safeParse(summaryResult.value);
		if (!parsedSummary.success) {
			throw new UnsupportedStatusPageError("Unexpected summary shape");
		}
		const summary = parsedSummary.data;
		const incidents = incidentsSchema.safeParse(incidentsRaw);
		const since = now.getTime() - INCIDENT_WINDOW_MS;

		const components = summary.components
			.filter(
				(component) =>
					!component.group_id &&
					(!component.only_show_if_degraded ||
						component.status !== "operational"),
			)
			.map(({ name, status }) => ({ name, status }))
			.slice(0, MAX_COMPONENTS);

		return {
			indicator: summary.status.indicator,
			description: summary.status.description,
			components,
			incidents: incidents.success
				? incidents.data.incidents
						.filter((incident) => {
							const createdAt = Date.parse(incident.created_at);
							return Number.isFinite(createdAt) && createdAt >= since;
						})
						.slice(0, MAX_INCIDENTS)
						.map((incident) => ({
							id: incident.id,
							name: incident.name,
							status: incident.status,
							impact: incident.impact,
							createdAt: new Date(incident.created_at).toISOString(),
							resolvedAt: toIsoOrNull(incident.resolved_at),
							url: incidentUrl(statusPageUrl, incident),
						}))
				: [],
		};
	} catch (error) {
		if (error instanceof UnsupportedStatusPageError) {
			logger.debug("Status page has no Statuspage API", {
				statusPageUrl,
				error: error.message,
			});
			return null;
		}
		throw error;
	}
}

function toIsoOrNull(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
