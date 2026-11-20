import { comparisonPath, featuredComparisons } from "@/lib/model-comparisons";
import { listedProviders } from "@/lib/providers-catalog";

import {
	models as modelDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

export interface ContentLink {
	label: string;
	href: string;
}

export interface ContentMentions {
	models: ContentLink[];
	providers: ContentLink[];
	comparisons: ContentLink[];
}

interface Candidate {
	kind: "model" | "provider";
	id: string;
	label: string;
	needle: string;
	pattern: RegExp;
	length: number;
}

const MIN_NAME_LENGTH = 5;
const MAX_MODELS = 8;
const MAX_PROVIDERS = 6;
const MAX_COMPARISONS = 4;
// Characters that continue a model id or name, so "gpt-4o" does not match
// inside "gpt-4o-mini".
const BOUNDARY = "[A-Za-z0-9.-]";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bounded(term: string, flags: string): RegExp {
	return new RegExp(
		`(?<!${BOUNDARY})${escapeRegExp(term)}(?!${BOUNDARY})`,
		flags,
	);
}

const candidates: Candidate[] = (() => {
	const list: Candidate[] = [];
	for (const model of modelDefinitions as readonly ModelDefinition[]) {
		if (model.providers.every((mapping) => isMappingDeactivated(mapping))) {
			continue;
		}
		const label = model.name ?? model.id;
		const terms =
			label.length >= MIN_NAME_LENGTH && label !== model.id
				? [model.id, label]
				: [model.id];
		for (const term of terms) {
			list.push({
				kind: "model",
				id: model.id,
				label,
				needle: term.toLowerCase(),
				// Ids are lowercase slugs that also appear capitalized in prose;
				// display names are matched as written.
				pattern: bounded(term, term === model.id ? "gi" : "g"),
				length: term.length,
			});
		}
	}
	for (const provider of listedProviders) {
		if (provider.name.length < MIN_NAME_LENGTH) {
			continue;
		}
		list.push({
			kind: "provider",
			id: provider.id,
			label: provider.name,
			needle: provider.name.toLowerCase(),
			pattern: bounded(provider.name, "g"),
			length: provider.name.length,
		});
	}
	// Longest first, so a match is consumed before a shorter name inside it.
	return list.sort((a, b) => b.length - a.length);
})();

interface MentionCounts {
	models: Map<string, { label: string; count: number }>;
	providers: Map<string, { label: string; count: number }>;
}

// Keyed by post body; capped so unexpected callers cannot grow it unbounded.
const MAX_CACHED_CONTENTS = 500;
const countsByContent = new Map<string, MentionCounts>();

function countMentions(content: string): MentionCounts {
	const cached = countsByContent.get(content);
	if (cached) {
		return cached;
	}
	const counts: MentionCounts = { models: new Map(), providers: new Map() };
	if (countsByContent.size >= MAX_CACHED_CONTENTS) {
		countsByContent.clear();
	}
	countsByContent.set(content, counts);
	const lowered = content.toLowerCase();
	let remaining = content;
	for (const candidate of candidates) {
		// Cheap substring test first: most candidates never appear in a post.
		if (!lowered.includes(candidate.needle)) {
			continue;
		}
		let count = 0;
		remaining = remaining.replace(candidate.pattern, (match) => {
			count++;
			return " ".repeat(match.length);
		});
		if (count === 0) {
			continue;
		}
		const bucket =
			candidate.kind === "model" ? counts.models : counts.providers;
		const existing = bucket.get(candidate.id);
		bucket.set(candidate.id, {
			label: candidate.label,
			count: (existing?.count ?? 0) + count,
		});
	}
	return counts;
}

function topLinks(
	bucket: Map<string, { label: string; count: number }>,
	limit: number,
	href: (id: string) => string,
): ContentLink[] {
	return Array.from(bucket.entries())
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, limit)
		.map(([id, value]) => ({ label: value.label, href: href(id) }));
}

/** Model, provider and comparison pages for the entities a text names. */
export function getContentMentions(content: string): ContentMentions {
	const counts = countMentions(content);
	return {
		models: topLinks(
			counts.models,
			MAX_MODELS,
			(id) => `/models/${encodeURIComponent(id)}`,
		),
		providers: topLinks(
			counts.providers,
			MAX_PROVIDERS,
			(id) => `/providers/${id}`,
		),
		comparisons: featuredComparisons
			.filter(
				(pair) =>
					counts.models.has(pair.left.id) && counts.models.has(pair.right.id),
			)
			.slice(0, MAX_COMPARISONS)
			.map((pair) => ({
				label: `${pair.left.name} vs ${pair.right.name}`,
				href: comparisonPath(pair.slug),
			})),
	};
}

export function mentionsModel(content: string, modelId: string): boolean {
	return countMentions(content).models.has(modelId);
}

export function mentionsProvider(content: string, providerId: string): boolean {
	return countMentions(content).providers.has(providerId);
}
