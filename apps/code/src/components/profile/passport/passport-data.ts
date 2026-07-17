import {
	AGENTS,
	type AgentDefinition,
} from "@/app/dashboard/components/coding-agents-shared";
import { resolveCanonicalModel } from "@/lib/model-family";

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

const AGENT_BY_SOURCE = new Map<string, AgentDefinition>();
for (const agent of AGENTS) {
	for (const source of agent.sources) {
		AGENT_BY_SOURCE.set(source.toLowerCase(), agent);
	}
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

export function buildPassportModel(profile: ProfileData): PassportModel {
	const airportMap = new Map<string, PassportAirport>();
	for (const row of profile.models) {
		const resolved = resolveCanonicalModel(row.id);
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
		const def = AGENT_BY_SOURCE.get(agent.source.toLowerCase());
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

	const stamps: PassportStampData[] = profile.models.slice(0, 6).map((row) => {
		const resolved = resolveCanonicalModel(row.id);
		return {
			model: resolved.name,
			family: familyLabel(resolved.known ? resolved.iconKey : row.provider),
			entry: row.firstUsed,
			exit: row.lastUsed,
			requestCount: row.requestCount,
		};
	});

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
