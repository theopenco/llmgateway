// Ranking and month pagination for the ⌘K model search palette. Pure so the
// API route and its tests share one implementation.

export interface ModelSearchEntry {
	id: string;
	name: string;
	family: string;
	aliases: string[];
	/** When the model was added to the catalogue (createdAt, else releasedAt). */
	addedAt: string | null;
	free: boolean;
	providerIds: string[];
	providerNames: string[];
}

export interface ModelSearchProvider {
	id: string;
	name: string;
}

export interface ModelSearchHit {
	entry: ModelSearchEntry;
	monthKey: string;
	score: number;
}

export interface ModelSearchPage {
	items: ModelSearchHit[];
	nextCursor: string | null;
	total: number;
	groupedByMonth: boolean;
}

export const MODEL_SEARCH_PAGE_SIZE = 20;
export const MODEL_SEARCH_MAX_PAGE_SIZE = 50;
export const MODEL_SEARCH_MAX_QUERY_LENGTH = 100;
export const UNKNOWN_MONTH_KEY = "unknown";

const MONTH_CURSOR_PREFIX = "m:";
const OFFSET_CURSOR_PREFIX = "o:";
const FUZZY_MIN_TOKEN_LENGTH = 4;

export function normalizeSearchText(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]/g, "");
}

/** Words of a label, split on whitespace and id separators (`-_./:`). */
export function searchWords(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[\s\-_./:+()[\]]+/)
		.map(normalizeSearchText)
		.filter(Boolean);
}

export function tokenizeSearchQuery(query: string): string[] {
	return searchWords(query.slice(0, MODEL_SEARCH_MAX_QUERY_LENGTH));
}

export function monthKeyOf(date: string | Date | null | undefined): string {
	if (!date) {
		return UNKNOWN_MONTH_KEY;
	}
	const d = typeof date === "string" ? new Date(date) : date;
	if (Number.isNaN(d.getTime())) {
		return UNKNOWN_MONTH_KEY;
	}
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(
	monthKey: string,
	style: "long" | "short" = "long",
): string {
	const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
	if (!match) {
		return "Unknown date";
	}
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: style,
		timeZone: "UTC",
	});
}

// Damerau-Levenshtein bounded at one edit: a single insertion, deletion,
// substitution or adjacent transposition.
export function withinOneEdit(a: string, b: string): boolean {
	if (a === b) {
		return true;
	}
	const lengthDiff = Math.abs(a.length - b.length);
	if (lengthDiff > 1) {
		return false;
	}
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) {
		i++;
	}
	if (lengthDiff === 1) {
		const longer = a.length > b.length ? a : b;
		const shorter = a.length > b.length ? b : a;
		return longer.slice(i + 1) === shorter.slice(i);
	}
	if (a.slice(i + 1) === b.slice(i + 1)) {
		return true;
	}
	return (
		a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
	);
}

interface IndexedEntry {
	entry: ModelSearchEntry;
	monthKey: string;
	addedAtMs: number;
	primaryTexts: string[];
	primaryWords: string[];
	secondaryText: string;
	secondaryWords: string[];
}

function indexEntry(entry: ModelSearchEntry): IndexedEntry {
	const primaryLabels = [entry.name, entry.id, ...entry.aliases];
	const secondaryLabels = [
		entry.family,
		...entry.providerNames,
		...entry.providerIds,
	];
	const addedAtMs = entry.addedAt ? new Date(entry.addedAt).getTime() : NaN;
	return {
		entry,
		monthKey: monthKeyOf(entry.addedAt),
		addedAtMs: Number.isNaN(addedAtMs) ? -Infinity : addedAtMs,
		primaryTexts: primaryLabels.map(normalizeSearchText).filter(Boolean),
		primaryWords: Array.from(new Set(primaryLabels.flatMap(searchWords))),
		secondaryText: normalizeSearchText(secondaryLabels.join(" ")),
		secondaryWords: Array.from(new Set(secondaryLabels.flatMap(searchWords))),
	};
}

const TOKEN_SCORE = {
	exactWord: 40,
	wordPrefix: 30,
	primarySubstring: 20,
	secondary: 10,
	fuzzy: 6,
	fuzzySecondary: 3,
} as const;

// One typo per token, but only for tokens long enough that an edit is
// unlikely to turn them into a different word.
function matchesFuzzyWord(token: string, words: string[]): boolean {
	return (
		token.length >= FUZZY_MIN_TOKEN_LENGTH &&
		words.some((word) => word[0] === token[0] && withinOneEdit(word, token))
	);
}

function scoreToken(token: string, indexed: IndexedEntry): number {
	if (indexed.primaryWords.includes(token)) {
		return TOKEN_SCORE.exactWord;
	}
	if (indexed.primaryWords.some((word) => word.startsWith(token))) {
		return TOKEN_SCORE.wordPrefix;
	}
	if (indexed.primaryTexts.some((text) => text.includes(token))) {
		return TOKEN_SCORE.primarySubstring;
	}
	if (indexed.secondaryText.includes(token)) {
		return TOKEN_SCORE.secondary;
	}
	if (matchesFuzzyWord(token, indexed.primaryWords)) {
		return TOKEN_SCORE.fuzzy;
	}
	if (matchesFuzzyWord(token, indexed.secondaryWords)) {
		return TOKEN_SCORE.fuzzySecondary;
	}
	return 0;
}

/**
 * Relevance of an entry for a query; 0 means it does not match. Every token
 * must match somewhere (a typo is tolerated per token), and whole-label hits
 * on the name, id or an alias outrank scattered word matches.
 */
export function scoreModelSearchEntry(
	entry: ModelSearchEntry,
	query: string,
): number {
	return scoreIndexedEntry(indexEntry(entry), query);
}

function scoreIndexedEntry(indexed: IndexedEntry, query: string): number {
	const tokens = tokenizeSearchQuery(query);
	if (tokens.length === 0) {
		return 0;
	}
	let score = 0;
	const primaryTokens: string[] = [];
	for (const token of tokens) {
		const tokenScore = scoreToken(token, indexed);
		if (tokenScore === 0) {
			return 0;
		}
		score += tokenScore;
		if (tokenScore >= TOKEN_SCORE.primarySubstring) {
			primaryTokens.push(token);
		}
	}
	// Whole-label bonus on the tokens that hit the labels themselves, so
	// "openai/gpt-5" still lands on gpt-5 rather than every OpenAI model.
	const phrase = primaryTokens.join("");
	if (!phrase) {
		return score;
	}
	if (indexed.primaryTexts.some((text) => text === phrase)) {
		score += 1000;
	} else if (indexed.primaryTexts.some((text) => text.startsWith(phrase))) {
		score += 500;
	} else if (indexed.primaryTexts.some((text) => text.includes(phrase))) {
		score += 250;
	}
	return score;
}

function compareByAdded(a: IndexedEntry, b: IndexedEntry): number {
	if (a.addedAtMs !== b.addedAtMs) {
		return b.addedAtMs - a.addedAtMs;
	}
	return a.entry.name.localeCompare(b.entry.name);
}

function clampLimit(limit: number | undefined): number {
	if (!limit || !Number.isFinite(limit)) {
		return MODEL_SEARCH_PAGE_SIZE;
	}
	return Math.min(MODEL_SEARCH_MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

function parseMonthCursor(
	cursor: string | null | undefined,
): { monthKey: string; offset: number } | null {
	if (!cursor?.startsWith(MONTH_CURSOR_PREFIX)) {
		return null;
	}
	const [monthKey, rawOffset = "0"] = cursor
		.slice(MONTH_CURSOR_PREFIX.length)
		.split(":");
	const offset = Number.parseInt(rawOffset, 10);
	return {
		monthKey,
		offset: Number.isFinite(offset) ? Math.max(0, offset) : 0,
	};
}

function parseOffsetCursor(cursor: string | null | undefined): number {
	if (!cursor?.startsWith(OFFSET_CURSOR_PREFIX)) {
		return 0;
	}
	const offset = Number.parseInt(cursor.slice(OFFSET_CURSOR_PREFIX.length), 10);
	return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

interface MonthGroup {
	monthKey: string;
	items: IndexedEntry[];
}

function groupByMonth(sorted: IndexedEntry[]): MonthGroup[] {
	const groups: MonthGroup[] = [];
	for (const item of sorted) {
		const last = groups[groups.length - 1];
		if (last && last.monthKey === item.monthKey) {
			last.items.push(item);
		} else {
			groups.push({ monthKey: item.monthKey, items: [item] });
		}
	}
	return groups;
}

// Month mode: newest month first, whole months per page (small months are
// batched until the page holds at least `limit` entries; an oversized month
// is split with an in-month offset so no page exceeds the hard cap).
function pageByMonth(
	sorted: IndexedEntry[],
	cursor: string | null | undefined,
	limit: number,
): ModelSearchPage {
	const groups = groupByMonth(sorted);
	const parsed = parseMonthCursor(cursor);
	let groupIndex = 0;
	let offset = 0;
	if (parsed) {
		// Months that vanished between requests fall through to the next
		// older month rather than restarting from the top.
		groupIndex = groups.findIndex((group) =>
			parsed.monthKey === UNKNOWN_MONTH_KEY
				? group.monthKey === UNKNOWN_MONTH_KEY
				: group.monthKey === UNKNOWN_MONTH_KEY ||
					group.monthKey <= parsed.monthKey,
		);
		if (groupIndex === -1) {
			return {
				items: [],
				nextCursor: null,
				total: sorted.length,
				groupedByMonth: true,
			};
		}
		offset =
			groups[groupIndex].monthKey === parsed.monthKey ? parsed.offset : 0;
	}

	const items: ModelSearchHit[] = [];
	let nextCursor: string | null = null;
	while (groupIndex < groups.length) {
		const group = groups[groupIndex];
		const remaining = Math.max(0, group.items.length - offset);
		const room = MODEL_SEARCH_MAX_PAGE_SIZE - items.length;
		const take = Math.min(remaining, room);
		for (const indexed of group.items.slice(offset, offset + take)) {
			items.push({ entry: indexed.entry, monthKey: group.monthKey, score: 0 });
		}
		if (take < remaining) {
			nextCursor = `${MONTH_CURSOR_PREFIX}${group.monthKey}:${offset + take}`;
			break;
		}
		groupIndex++;
		offset = 0;
		if (items.length >= limit) {
			nextCursor =
				groupIndex < groups.length
					? `${MONTH_CURSOR_PREFIX}${groups[groupIndex].monthKey}:0`
					: null;
			break;
		}
	}
	return { items, nextCursor, total: sorted.length, groupedByMonth: true };
}

function pageByRelevance(
	scored: Array<IndexedEntry & { score: number }>,
	cursor: string | null | undefined,
	limit: number,
): ModelSearchPage {
	const offset = parseOffsetCursor(cursor);
	const slice = scored.slice(offset, offset + limit);
	return {
		items: slice.map(({ entry, monthKey, score }) => ({
			entry,
			monthKey,
			score,
		})),
		nextCursor:
			offset + limit < scored.length
				? `${OFFSET_CURSOR_PREFIX}${offset + limit}`
				: null,
		total: scored.length,
		groupedByMonth: false,
	};
}

export interface ModelSearchOptions {
	query?: string | null;
	cursor?: string | null;
	limit?: number;
}

/**
 * One page of the palette. Without a query the catalogue is walked newest
 * month first; with one, hits are ranked by relevance and paged by offset.
 */
export function searchModelEntries(
	entries: ModelSearchEntry[],
	{ query, cursor, limit }: ModelSearchOptions = {},
): ModelSearchPage {
	const pageSize = clampLimit(limit);
	const indexed = entries.map(indexEntry);
	const trimmedQuery = (query ?? "").trim();
	if (tokenizeSearchQuery(trimmedQuery).length === 0) {
		return pageByMonth(indexed.sort(compareByAdded), cursor, pageSize);
	}
	const scored = indexed
		.map((item) => ({ ...item, score: scoreIndexedEntry(item, trimmedQuery) }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || compareByAdded(a, b));
	return pageByRelevance(scored, cursor, pageSize);
}

export function searchModelProviders(
	providers: ModelSearchProvider[],
	query: string | null | undefined,
): ModelSearchProvider[] {
	const tokens = tokenizeSearchQuery(query ?? "");
	if (tokens.length === 0) {
		return [];
	}
	return providers.filter((provider) => {
		const label = `${provider.name} ${provider.id}`;
		const text = normalizeSearchText(label);
		const words = searchWords(label);
		return tokens.every(
			(token) => text.includes(token) || matchesFuzzyWord(token, words),
		);
	});
}

/**
 * Raw character ranges of `text` matched by the query, for `<mark>`
 * highlighting. Matching ignores case, accents and separators, exactly like
 * the ranking does, and returns non-overlapping ranges in reading order.
 */
export function searchMatchRanges(
	text: string,
	query: string,
): Array<[number, number]> {
	const tokens = tokenizeSearchQuery(query);
	if (tokens.length === 0 || !text) {
		return [];
	}
	const rawIndexes: number[] = [];
	let normalized = "";
	for (let i = 0; i < text.length; i++) {
		const piece = normalizeSearchText(text[i]);
		for (let j = 0; j < piece.length; j++) {
			rawIndexes.push(i);
		}
		normalized += piece;
	}
	const ranges: Array<[number, number]> = [];
	// Single characters ("4", "5") light up every digit in a label, so only the
	// whole phrase and multi-character tokens are marked.
	const needles = [tokens.join(""), ...tokens.filter((t) => t.length >= 2)];
	for (const token of needles) {
		let from = 0;
		while (from <= normalized.length - token.length) {
			const at = normalized.indexOf(token, from);
			if (at === -1) {
				break;
			}
			ranges.push([rawIndexes[at], rawIndexes[at + token.length - 1] + 1]);
			from = at + token.length;
		}
	}
	ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push([range[0], range[1]]);
		}
	}
	return merged;
}
