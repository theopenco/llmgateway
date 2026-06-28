import type { PoolClient } from "pg";

/**
 * Tags appended to every SQL statement as a sqlcommenter comment so the source
 * of a query is visible in Google Cloud SQL Query Insights.
 *
 * Query Insights only aggregates on a fixed set of tag keys: `application`,
 * `route`, `controller`, `action`, `framework`, `db_driver`, `traceparent` and
 * `tracestate`. Use `application` (e.g. "gateway", "api", "worker") to see
 * which service issued a query in the Query Insights "By tag" view. Other keys
 * are still emitted in the SQL comment but are not given their own dimension.
 */
export interface QueryTags {
	[key: string]: string | undefined;
}

let comment = "";

/**
 * URL-encode per the sqlcommenter spec, including the characters that
 * encodeURIComponent leaves untouched.
 */
function encode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
	);
}

/**
 * Serialize tags into a sqlcommenter comment: keys sorted alphabetically,
 * key and value URL-encoded, value single-quoted. For example, the tag
 * { application: "gateway" } becomes a comment containing application='gateway'.
 */
function serialize(tags: QueryTags): string {
	const parts = Object.keys(tags)
		.filter((key) => tags[key] !== undefined && tags[key] !== "")
		.sort()
		.map((key) => `${encode(key)}='${encode(String(tags[key]))}'`);
	return parts.length ? `/*${parts.join(",")}*/` : "";
}

/**
 * Set the process-wide tags appended to every SQL query. Call once at each
 * app's startup, e.g. `setQueryTags({ application: "gateway" })`.
 *
 * Tags are static per process on purpose: the comment becomes part of the query
 * text, so a per-request value would break prepared-statement caching and could
 * spam Query Insights with unique statements.
 */
export function setQueryTags(tags: QueryTags): void {
	comment = serialize(tags);
}

/** The current sqlcommenter comment, or "" when no tags are set. */
export function getQueryTagComment(): string {
	return comment;
}

function tag(text: string): string {
	if (!comment) {
		return text;
	}
	// Leave statements that already carry a comment untouched, to avoid
	// double-tagging or interfering with an intentional comment.
	if (text.includes("/*")) {
		return text;
	}
	return `${text} ${comment}`;
}

const PATCHED = Symbol.for("llmgateway.db.queryTagPatched");

/**
 * Patch a pg client's `query` so every statement it runs gets the current tag
 * comment appended. Patching the client (rather than the pool) also covers
 * transactions, which check out a dedicated client and bypass `pool.query`.
 *
 * Idempotent: a client is patched at most once.
 */
export function patchClientQuery(client: PoolClient): void {
	const target = client as unknown as Record<symbol, unknown> & {
		query: (...args: unknown[]) => unknown;
	};
	if (target[PATCHED]) {
		return;
	}
	target[PATCHED] = true;

	const original = client.query.bind(client);
	target.query = function (config: unknown, ...rest: unknown[]) {
		if (typeof config === "string") {
			config = tag(config);
		} else if (
			config &&
			typeof config === "object" &&
			typeof (config as { text?: unknown }).text === "string" &&
			// Submittable configs (Cursor, prepared queries) carry their own
			// lifecycle; don't rewrite them.
			typeof (config as { submit?: unknown }).submit !== "function"
		) {
			const cfg = config as { text: string };
			config = { ...cfg, text: tag(cfg.text) };
		}
		return original(config as never, ...(rest as never[]));
	};
}
