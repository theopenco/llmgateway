import { Decimal } from "decimal.js";

import { escapeHtml } from "@llmgateway/shared/email-unsubscribe";

const SITE = "https://llmgateway.io";
const TRACKING = "utm_source=newsletter&utm_medium=email&utm_campaign=new-models";
const FROM = "LLM Gateway <contact@mail.llmgateway.io>";
const REPLY_TO = "contact@llmgateway.io";
const DAY_MS = 86_400_000;
const PER_MILLION = 1_000_000;
const MIN_PRICE_DECIMALS = 2;
// What the database stores for a name or description nobody filled in.
const EMPTY_TEXT = "(empty)";

export interface DigestModelInput {
	id: string;
	name?: string;
	description?: string;
	releasedAt?: Date;
	addedAt?: Date;
	providers: ReadonlyArray<{
		providerId: string;
		inputPrice?: string;
		outputPrice?: string;
		contextSize?: number;
		deactivatedAt?: Date;
	}>;
}

/** The fields of `GET /internal/models` the issue is built from. */
export interface CatalogueModel {
	id: string;
	name: string | null;
	description: string | null;
	createdAt: string;
	releasedAt: string | null;
	status: "active" | "inactive";
	unlistedProviderIds?: string[];
	mappings: ReadonlyArray<{
		providerId: string;
		inputPrice: string | null;
		outputPrice: string | null;
		contextSize: number | null;
		deactivatedAt: string | null;
		status: "active" | "inactive";
	}>;
}

export interface DigestChangelogInput {
	slug: string;
	title: string;
	summary: string;
	date: string;
	draft?: boolean;
}

export interface DigestModel {
	id: string;
	name: string;
	description: string;
	landedAt: Date;
	providers: string[];
	context: string | null;
	price: string | null;
	url: string;
}

export interface DigestChangelogEntry {
	title: string;
	summary: string;
	url: string;
}

export interface Digest {
	subject: string;
	previewText: string;
	html: string;
	text: string;
	models: DigestModel[];
	changelog: DigestChangelogEntry[];
}

export interface DigestInput {
	models: ReadonlyArray<DigestModelInput>;
	providerNames: ReadonlyMap<string, string>;
	changelog: ReadonlyArray<DigestChangelogInput>;
	now: Date;
	days: number;
	/** First day the issue does not cover. Defaults to the day of `now`. */
	until?: Date;
	postalAddress: string;
}

export interface DigestWindow {
	start: Date;
	end: Date;
}

/**
 * The `days` whole UTC days before the day of `until`. A repeated run covers
 * the same period, and back-to-back weekly runs neither skip nor repeat a
 * release.
 */
export function digestWindow(until: Date, days: number): DigestWindow {
	const end = Date.UTC(
		until.getUTCFullYear(),
		until.getUTCMonth(),
		until.getUTCDate(),
	);
	return { start: new Date(end - days * DAY_MS), end: new Date(end) };
}

function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** The first and last day an issue covers, for the run summary. */
export function describeWindow(until: Date, days: number): string {
	const { start, end } = digestWindow(until, days);
	return `${isoDay(start)} to ${isoDay(new Date(end.getTime() - DAY_MS))} (UTC)`;
}

/**
 * Reads `--until`: today when absent, otherwise a calendar day that exists and
 * is not in the future.
 */
export function parseUntil(value: string | undefined, now: Date): Date {
	if (value === undefined) {
		return now;
	}
	const until = new Date(`${value}T00:00:00Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		Number.isNaN(until.getTime()) ||
		isoDay(until) !== value
	) {
		throw new Error("--until must be a real date like 2026-11-16");
	}
	if (until > now) {
		throw new Error("--until cannot be in the future");
	}
	return until;
}

function inWindow(time: number, window: DigestWindow): boolean {
	return time >= window.start.getTime() && time < window.end.getTime();
}

/** A per-token price as dollars per million tokens: `4e-6` reads `$4`. */
export function formatPerMillion(price: string): string {
	const value = new Decimal(price).times(PER_MILLION);
	const decimals = value.isInteger()
		? 0
		: Math.max(value.decimalPlaces(), MIN_PRICE_DECIMALS);
	return `$${value.toFixed(decimals)}`;
}

export function formatContext(tokens: number): string {
	if (tokens >= PER_MILLION) {
		const millions = new Decimal(tokens).div(PER_MILLION).toDecimalPlaces(1);
		return `${millions.toString()}M context`;
	}
	return `${Math.round(tokens / 1000)}K context`;
}

function link(path: string): string {
	return `${SITE}${path}?${TRACKING}`;
}

/** A failed or empty read must stop the run, never read as a quiet week. */
export function readCatalogueList<T>(
	body: unknown,
	resource: "models" | "providers",
): T[] {
	const items =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)[resource]
			: undefined;
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error(`The API returned no ${resource}`);
	}
	return items as T[];
}

function filledIn(text: string | null): string | undefined {
	return text && text !== EMPTY_TEXT ? text : undefined;
}

/**
 * Drops what the site hides: inactive models and mappings, and provider
 * listings that are paused or delisted.
 */
export function fromCatalogue(
	models: ReadonlyArray<CatalogueModel>,
): DigestModelInput[] {
	return models
		.filter((model) => model.status !== "inactive")
		.map((model) => {
			const unlisted = new Set(model.unlistedProviderIds ?? []);
			return {
				id: model.id,
				name: filledIn(model.name),
				description: filledIn(model.description),
				releasedAt: model.releasedAt ? new Date(model.releasedAt) : undefined,
				addedAt: new Date(model.createdAt),
				providers: model.mappings
					.filter(
						(mapping) =>
							mapping.status !== "inactive" && !unlisted.has(mapping.providerId),
					)
					.map((mapping) => ({
						providerId: mapping.providerId,
						inputPrice: mapping.inputPrice ?? undefined,
						outputPrice: mapping.outputPrice ?? undefined,
						contextSize: mapping.contextSize ?? undefined,
						deactivatedAt: mapping.deactivatedAt
							? new Date(mapping.deactivatedAt)
							: undefined,
					})),
			};
		});
}

/**
 * When the model became usable here: the day it was added, or its release date
 * when it was added ahead of release. An older model the gateway picks up
 * later is new to readers too.
 */
function landedAt(model: DigestModelInput): Date | undefined {
	if (!model.addedAt || !model.releasedAt) {
		return model.addedAt ?? model.releasedAt;
	}
	return model.addedAt > model.releasedAt ? model.addedAt : model.releasedAt;
}

export function selectNewModels(
	models: ReadonlyArray<DigestModelInput>,
	providerNames: ReadonlyMap<string, string>,
	now: Date,
	days: number,
	until: Date = now,
): DigestModel[] {
	const window = digestWindow(until, days);
	const selected: DigestModel[] = [];
	for (const model of models) {
		const landed = landedAt(model);
		if (!landed || !inWindow(landed.getTime(), window)) {
			continue;
		}
		const active = model.providers.filter(
			(mapping) =>
				!mapping.deactivatedAt || mapping.deactivatedAt.getTime() > now.getTime(),
		);
		if (active.length === 0) {
			continue;
		}
		// Image and video models bill their output some other way and carry a
		// zero token price, which would read as free.
		const priced = active
			.filter(
				(mapping) =>
					new Decimal(mapping.inputPrice ?? 0).greaterThan(0) &&
					new Decimal(mapping.outputPrice ?? 0).greaterThan(0),
			)
			.sort((a, b) =>
				new Decimal(a.inputPrice ?? 0).comparedTo(b.inputPrice ?? 0),
			);
		const cheapest = priced[0];
		const contexts = active
			.map((mapping) => mapping.contextSize ?? 0)
			.filter((size) => size > 0);
		selected.push({
			id: model.id,
			name: model.name ?? model.id,
			description: model.description ?? "",
			landedAt: landed,
			providers: [
				...new Set(
					active.map(
						(mapping) =>
							providerNames.get(mapping.providerId) ?? mapping.providerId,
					),
				),
			],
			context: contexts.length ? formatContext(Math.max(...contexts)) : null,
			price:
				cheapest?.inputPrice && cheapest.outputPrice
					? `from ${formatPerMillion(cheapest.inputPrice)} in / ${formatPerMillion(cheapest.outputPrice)} out per 1M tokens`
					: null,
			url: link(`/models/${encodeURIComponent(model.id)}`),
		});
	}
	return selected.sort(
		(a, b) =>
			b.landedAt.getTime() - a.landedAt.getTime() ||
			a.name.localeCompare(b.name),
	);
}

function frontmatterValue(source: string, key: string): string | undefined {
	const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(source);
	if (!match) {
		return undefined;
	}
	const raw = match[1].trim();
	return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
}

/** Reads the frontmatter fields the issue needs from one changelog file. */
export function parseChangelogEntry(
	source: string,
	file: string,
): DigestChangelogInput {
	const frontmatter = source.split("\n---")[0];
	const slug = frontmatterValue(frontmatter, "slug");
	const title = frontmatterValue(frontmatter, "title");
	const summary = frontmatterValue(frontmatter, "summary");
	const date = frontmatterValue(frontmatter, "date");
	if (!slug || !title || !summary || !date) {
		throw new Error(`Changelog entry ${file} is missing frontmatter`);
	}
	return {
		slug,
		title,
		summary,
		date,
		draft: frontmatterValue(frontmatter, "draft") === "true",
	};
}

export function selectChangelog(
	entries: ReadonlyArray<DigestChangelogInput>,
	until: Date,
	days: number,
): DigestChangelogEntry[] {
	const window = digestWindow(until, days);
	return entries
		.filter(
			(entry) =>
				!entry.draft &&
				inWindow(new Date(`${entry.date}T00:00:00Z`).getTime(), window),
		)
		.sort((a, b) => b.date.localeCompare(a.date))
		.map((entry) => ({
			title: entry.title,
			summary: entry.summary,
			url: link(`/changelog/${encodeURIComponent(entry.slug)}`),
		}));
}

export function buildSubject(models: ReadonlyArray<DigestModel>): string {
	const names = models.map((model) => model.name);
	if (names.length === 1) {
		return `New on LLM Gateway: ${names[0]}`;
	}
	if (names.length === 2) {
		return `New on LLM Gateway: ${names[0]} and ${names[1]}`;
	}
	return `New on LLM Gateway: ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function buildIntro(count: number, days: number): string {
	const period = days === 7 ? "in the past week" : `in the past ${days} days`;
	return count === 1
		? `One new model landed on LLM Gateway ${period}.`
		: `${count} new models landed on LLM Gateway ${period}.`;
}

function modelMeta(model: DigestModel): string {
	return [model.providers.join(", "), model.context, model.price]
		.filter(Boolean)
		.join(" · ");
}

function renderText(
	intro: string,
	models: DigestModel[],
	changelog: DigestChangelogEntry[],
	postalAddress: string,
): string {
	const lines = ["Hi {{{contact.first_name|there}}},", "", intro, ""];
	for (const model of models) {
		lines.push(model.name, modelMeta(model));
		if (model.description) {
			lines.push(model.description);
		}
		lines.push(model.url, "");
	}
	if (changelog.length) {
		lines.push("Also shipped", "");
		for (const entry of changelog) {
			lines.push(entry.title, entry.summary, entry.url, "");
		}
	}
	lines.push(
		`Every release, by date: ${link("/timeline")}`,
		"",
		"---",
		"You get this because you subscribed to LLM Gateway updates.",
		"Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}",
		`LLM Gateway. ${postalAddress}`,
	);
	return lines.join("\n");
}

function renderHtml(
	intro: string,
	models: DigestModel[],
	changelog: DigestChangelogEntry[],
	postalAddress: string,
): string {
	const modelRows = models
		.map(
			(model) => `<tr><td style="padding:0 0 24px;">
<a href="${escapeHtml(model.url)}" style="color:#111111;font-size:18px;font-weight:600;text-decoration:none;">${escapeHtml(model.name)}</a>
<p style="margin:4px 0 0;color:#666666;font-size:13px;line-height:1.5;">${escapeHtml(modelMeta(model))}</p>
${model.description ? `<p style="margin:8px 0 0;color:#333333;font-size:15px;line-height:1.6;">${escapeHtml(model.description)}</p>` : ""}
<p style="margin:8px 0 0;font-size:14px;"><a href="${escapeHtml(model.url)}" style="color:#2563eb;text-decoration:none;">Pricing and providers</a></p>
</td></tr>`,
		)
		.join("\n");
	const changelogRows = changelog.length
		? `<tr><td style="padding:8px 0 12px;border-top:1px solid #eeeeee;color:#111111;font-size:16px;font-weight:600;">Also shipped</td></tr>
${changelog
	.map(
		(entry) => `<tr><td style="padding:0 0 16px;">
<a href="${escapeHtml(entry.url)}" style="color:#2563eb;font-size:15px;text-decoration:none;">${escapeHtml(entry.title)}</a>
<p style="margin:4px 0 0;color:#555555;font-size:14px;line-height:1.5;">${escapeHtml(entry.summary)}</p>
</td></tr>`,
	)
	.join("\n")}`
		: "";
	return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:32px 32px 8px;">
<p style="margin:0 0 4px;color:#666666;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">LLM Gateway · New models</p>
<p style="margin:16px 0 24px;color:#111111;font-size:16px;line-height:1.6;">Hi {{{contact.first_name|there}}}, ${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${modelRows}
${changelogRows}
</table>
<p style="margin:8px 0 32px;font-size:15px;"><a href="${escapeHtml(link("/timeline"))}" style="color:#2563eb;text-decoration:none;">Every release, by date</a></p>
</td></tr>
<tr><td style="padding:20px 32px;background-color:#fafafa;border-top:1px solid #eeeeee;border-radius:0 0 8px 8px;color:#888888;font-size:12px;line-height:1.6;">
You get this because you subscribed to LLM Gateway updates. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#888888;">Unsubscribe</a>.<br />
LLM Gateway. ${escapeHtml(postalAddress)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Null when nothing landed in the window: there is no issue to send. */
export function buildDigest(input: DigestInput): Digest | null {
	const until = input.until ?? input.now;
	const models = selectNewModels(
		input.models,
		input.providerNames,
		input.now,
		input.days,
		until,
	);
	if (models.length === 0) {
		return null;
	}
	const changelog = selectChangelog(input.changelog, until, input.days);
	const intro = buildIntro(models.length, input.days);
	return {
		subject: buildSubject(models),
		previewText: models.map((model) => model.name).join(", "),
		html: renderHtml(intro, models, changelog, input.postalAddress),
		text: renderText(intro, models, changelog, input.postalAddress),
		models,
		changelog,
	};
}

/**
 * The body of `POST /broadcasts`. It carries no `send` and no `scheduled_at`,
 * so Resend saves a draft. The topic is required: without it Resend ignores
 * topic preferences and reaches contacts who opted out of the newsletter.
 */
export function buildBroadcastDraft(
	digest: Digest,
	target: { segmentId: string; topicId: string },
) {
	return {
		segment_id: target.segmentId,
		topic_id: target.topicId,
		from: FROM,
		reply_to: REPLY_TO,
		name: digest.subject,
		subject: digest.subject,
		preview_text: digest.previewText,
		html: digest.html,
		text: digest.text,
	};
}
