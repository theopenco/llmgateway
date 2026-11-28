import { agentForSource } from "@/app/dashboard/components/coding-agents-shared";

import type { ProfileData } from "@/components/profile/ProfileView";

/** One "airport" on the ports-of-entry page: a model family. */
export interface PassportAirport {
	/** IATA-style three-letter code derived from the family name. */
	code: string;
	label: string;
	requestCount: number;
}

/** One "airline" on the carriers page: a coding-agent harness. */
export interface PassportAirline {
	label: string;
	requestCount: number;
	totalTokens: number;
}

/** One entry/exit stamp: a model with its first and last use. */
export interface PassportStampData {
	model: string;
	family: string;
	entry: string | null;
	exit: string | null;
	requestCount: number;
}

export interface PassportVisa {
	tier: "lite" | "pro" | "max";
	startedAt: string | null;
	expiresAt: string | null;
}

export interface PassportModel {
	holderName: string;
	username: string | null;
	memberSince: string;
	visa: PassportVisa | null;
	airports: PassportAirport[];
	airlines: PassportAirline[];
	stamps: PassportStampData[];
	totalRequests: number;
	activeDays: number;
}

// Human labels for model families whose icon key isn't display-ready.
const FAMILY_LABELS: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	"google-ai-studio": "Google",
	google: "Google",
	alibaba: "Alibaba",
	zai: "Z.ai",
	deepseek: "DeepSeek",
	meta: "Meta",
	mistral: "Mistral",
	moonshot: "Moonshot",
	xai: "xAI",
	minimax: "MiniMax",
};

function familyLabel(key: string): string {
	const known = FAMILY_LABELS[key.toLowerCase()];
	if (known) {
		return known;
	}
	return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Derive a stable IATA-style code from a family label, e.g. "Anthropic" ->
 * "ANT", "OpenAI" -> "OPE", "Z.ai" -> "ZAI". Purely cosmetic.
 */
function airportCode(label: string): string {
	const letters = label.toUpperCase().replace(/[^A-Z]/g, "");
	return (letters + "XXX").slice(0, 3);
}

/** UTC date label shared by the page textures and the screen-reader summary. */
export function formatPassportDate(iso: string | null): string {
	if (!iso) {
		return "—";
	}
	return new Date(iso)
		.toLocaleDateString("en-GB", {
			day: "2-digit",
			month: "short",
			year: "numeric",
			timeZone: "UTC",
		})
		.toUpperCase();
}

/**
 * Plain-text description of the currently visible spread for assistive
 * technology — the canvas pages themselves are invisible to screen readers.
 */
export function spreadSummary(model: PassportModel, turned: number): string {
	switch (turned) {
		case 0:
			return `Closed DevPass passport of ${model.holderName}. Press Enter or tap to open it.`;
		case 1: {
			const visa = model.visa
				? `${model.visa.tier.toUpperCase()} visa, valid from ${formatPassportDate(model.visa.startedAt)} until ${formatPassportDate(model.visa.expiresAt)}`
				: "no active visa";
			return `Visa page for ${model.holderName}: ${visa}.`;
		}
		case 2: {
			const ports =
				model.airports.map((a) => `${a.label} (${a.code})`).join(", ") ||
				"none visited yet";
			const carriers =
				model.airlines.map((a) => a.label).join(", ") || "none on record";
			return `Ports of entry, model families: ${ports}. Carriers, harnesses: ${carriers}.`;
		}
		case 3: {
			const stamps =
				model.stamps
					.map(
						(s) =>
							`${s.model}: entry ${formatPassportDate(s.entry)}, exit ${formatPassportDate(s.exit)}`,
					)
					.join("; ") || "awaiting first entry";
			return `Entry and exit stamps: ${stamps}.`;
		}
		default:
			return `Endorsements: ${model.totalRequests} requests across ${model.activeDays} active days.`;
	}
}

function earlierDate(a: string | null, b: string | null): string | null {
	if (!a || !b) {
		return a ?? b;
	}
	return Date.parse(b) < Date.parse(a) ? b : a;
}

function laterDate(a: string | null, b: string | null): string | null {
	if (!a || !b) {
		return a ?? b;
	}
	return Date.parse(b) > Date.parse(a) ? b : a;
}

export function buildPassportModel(profile: ProfileData): PassportModel {
	const airportMap = new Map<string, PassportAirport>();
	for (const row of profile.models) {
		const resolved = row.canonical;
		const key = resolved.known ? resolved.iconKey : row.provider;
		const label = familyLabel(key);
		const existing = airportMap.get(label);
		if (existing) {
			existing.requestCount += row.requestCount;
		} else {
			airportMap.set(label, {
				code: airportCode(label),
				label,
				requestCount: row.requestCount,
			});
		}
	}

	const airlineMap = new Map<string, PassportAirline>();
	for (const agent of profile.agents) {
		const def = agentForSource(agent.source);
		const label = def?.label ?? agent.source;
		const existing = airlineMap.get(label);
		if (existing) {
			existing.requestCount += agent.requestCount;
			existing.totalTokens += agent.totalTokens;
		} else {
			airlineMap.set(label, {
				label,
				requestCount: agent.requestCount,
				totalTokens: agent.totalTokens,
			});
		}
	}

	const stampMap = new Map<string, PassportStampData>();
	for (const row of profile.models) {
		const resolved = row.canonical;
		const existing = stampMap.get(resolved.id);
		if (existing) {
			existing.requestCount += row.requestCount;
			existing.entry = earlierDate(existing.entry, row.firstUsed);
			existing.exit = laterDate(existing.exit, row.lastUsed);
		} else {
			stampMap.set(resolved.id, {
				model: resolved.name,
				family: familyLabel(resolved.known ? resolved.iconKey : row.provider),
				entry: row.firstUsed,
				exit: row.lastUsed,
				requestCount: row.requestCount,
			});
		}
	}
	const stamps = Array.from(stampMap.values())
		.sort((a, b) => b.requestCount - a.requestCount)
		.slice(0, 6);

	return {
		holderName: profile.name?.trim() || profile.username || "Traveller",
		username: profile.username,
		memberSince: profile.createdAt,
		visa: profile.plan,
		airports: Array.from(airportMap.values()).sort(
			(a, b) => b.requestCount - a.requestCount,
		),
		airlines: Array.from(airlineMap.values()).sort(
			(a, b) => b.requestCount - a.requestCount,
		),
		stamps,
		totalRequests: profile.stats.totalRequests,
		activeDays: profile.stats.activeDays,
	};
}
