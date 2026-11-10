import { Decimal } from "decimal.js";

const SITE = "https://llmgateway.io";
const TRACKING = "utm_source=newsletter&utm_medium=email&utm_campaign=new-models";
const DAY_MS = 86_400_000;
const PER_MILLION = 1_000_000;

export interface DigestModelInput {
	id: string;
	name?: string;
	description?: string;
	releasedAt?: Date;
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
	releasedAt: Date;
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
	postalAddress: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** A per-token price as dollars per million tokens: `4e-6` reads `$4`. */
export function formatPerMillion(price: string): string {
	const value = new Decimal(price).times(PER_MILLION);
	if (value.isInteger()) {
		return `$${value.toFixed(0)}`;
	}
	return `$${value.toFixed(3).replace(/0$/, "")}`;
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
				name: model.name ?? undefined,
				description: model.description ?? undefined,
				releasedAt: model.releasedAt ? new Date(model.releasedAt) : undefined,
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

export function selectNewModels(
	models: ReadonlyArray<DigestModelInput>,
	providerNames: ReadonlyMap<string, string>,
	now: Date,
	days: number,
): DigestModel[] {
	const since = now.getTime() - days * DAY_MS;
	const selected: DigestModel[] = [];
	for (const model of models) {
		const releasedAt = model.releasedAt;
		if (
			!releasedAt ||
			releasedAt.getTime() <= since ||
			releasedAt.getTime() > now.getTime()
		) {
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
			releasedAt,
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
			b.releasedAt.getTime() - a.releasedAt.getTime() ||
			a.name.localeCompare(b.name),
	);
}

export function selectChangelog(
	entries: ReadonlyArray<DigestChangelogInput>,
	now: Date,
	days: number,
): DigestChangelogEntry[] {
	const since = now.getTime() - days * DAY_MS;
	return entries
		.filter((entry) => {
			const date = new Date(`${entry.date}T00:00:00Z`).getTime();
			return !entry.draft && date > since && date <= now.getTime();
		})
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

function modelMeta(model: DigestModel): string {
	return [model.providers.join(", "), model.context, model.price]
		.filter(Boolean)
		.join(" · ");
}

function renderText(
	models: DigestModel[],
	changelog: DigestChangelogEntry[],
	postalAddress: string,
): string {
	const lines = [
		"Hi {{{contact.first_name|there}}},",
		"",
		models.length === 1
			? "One new model landed on LLM Gateway this week."
			: `${models.length} new models landed on LLM Gateway this week.`,
		"",
	];
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
	const intro =
		models.length === 1
			? "One new model landed on LLM Gateway this week."
			: `${models.length} new models landed on LLM Gateway this week.`;
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

/** Null when nothing was released in the window: there is no issue to send. */
export function buildDigest(input: DigestInput): Digest | null {
	const models = selectNewModels(
		input.models,
		input.providerNames,
		input.now,
		input.days,
	);
	if (models.length === 0) {
		return null;
	}
	const changelog = selectChangelog(input.changelog, input.now, input.days);
	return {
		subject: buildSubject(models),
		previewText: models.map((model) => model.name).join(", "),
		html: renderHtml(models, changelog, input.postalAddress),
		text: renderText(models, changelog, input.postalAddress),
		models,
		changelog,
	};
}
