import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	internalClassifierChecksFromLog,
	type ContentFilteredLogRow,
	type InternalClassifierCheck,
} from "@/lib/internal-classifier-checks.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import { and, asc, db, gte, lt, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

export const adminInternalClassifierChecks = new OpenAPIHono<ServerTypes>();

adminInternalClassifierChecks.use("/*", adminMiddleware);

const HOUR_MS = 60 * 60 * 1000;
// Log rows per page; each holds one verdict per chunk of text read.
const PAGE_SIZE = 2000;
const SETTLE_MS = 60_000;
// ~20k content-filtered requests an hour; blocks are filtered from the same
// index scan, so both share the cap.
const MAX_RANGE_HOURS = 24;

// The classifier's audit CSV columns, in its order, then ours.
export const INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS = [
	"ts",
	"rule",
	"reasons",
	"tags",
	"score",
	"salt_id",
	"algo_version",
	"fp_status",
	"prompt_bytes",
	"simhash",
	"simhash_global",
	"exact_hash",
	"conversation_key",
	"minhash_b64",
	"band_keys",
	"request_id",
	"account_id",
	"decision",
	"project_id",
	"api_key_id",
	"used_model",
	"used_provider",
	"chunk_index",
	"internal_scope",
	"tier",
	"level",
	"action",
] as const;

const exportQuerySchema = z.object({
	from: z.string().datetime({ offset: true }),
	to: z.string().datetime({ offset: true }),
	decision: z.enum(["all", "block"]).default("all").optional(),
});

const exportChecks = createRoute({
	method: "get",
	path: "/content-filter/internal-checks/export",
	request: { query: exportQuerySchema },
	responses: {
		200: {
			content: {
				"text/csv": { schema: z.string() },
			},
			description:
				"Internal classifier verdicts of requests logged in [from, to) as CSV, every verdict or blocks only: the classifier's audit CSV columns (fingerprints included) followed by the request's project, key, model and content filter outcome. Read from the log's content filter response, so only the 30-day payload retention window has data.",
		},
	},
});

const log = tables.log;
// Microsecond ISO text: the export's ts and the keyset cursor, which a JS
// Date would round to milliseconds.
const createdAtText = sql<string>`to_char(${log.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Request ids can come from the client, so formula triggers are neutralized;
// "-" is not among them, which keeps negative hashes and band keys intact.
function csvField(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	let text = String(value);
	if (/^[=+@\t\r]/.test(text)) {
		text = `'${text}`;
	}
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function internalClassifierCheckCsvLine(
	row: InternalClassifierCheck,
): string {
	return [
		row.ts,
		row.rule,
		row.reasons.join(";"),
		row.tags.join(";"),
		row.score === null ? null : row.score.toFixed(4),
		row.saltId,
		row.algoVersion,
		row.fpStatus,
		row.promptBytes,
		row.simhash,
		row.simhashGlobal,
		row.exactHash,
		row.conversationKey,
		row.minhashB64,
		row.bandKeys?.join(";"),
		row.requestId,
		row.organizationId,
		row.decision,
		row.projectId,
		row.apiKeyId,
		row.usedModel,
		row.usedProvider,
		row.chunkIndex,
		row.internalScope,
		row.tier,
		row.level,
		row.action,
	]
		.map(csvField)
		.join(",");
}

adminInternalClassifierChecks.openapi(exportChecks, async (c) => {
	const query = c.req.valid("query");
	const decision = query.decision ?? "all";
	const from = new Date(query.from);
	const to = new Date(query.to);
	if (to <= from) {
		throw new HTTPException(400, { message: "to must be after from" });
	}
	if (to.getTime() - from.getTime() > MAX_RANGE_HOURS * HOUR_MS) {
		throw new HTTPException(400, {
			message: `Range exceeds ${MAX_RANGE_HOURS} hours`,
		});
	}

	// created_at is the inserting transaction's start; one that commits after
	// a page was read would land behind the cursor, so recent rows wait.
	const until = new Date(Math.min(to.getTime(), Date.now() - SETTLE_MS));
	let cursor: { ts: string; id: string } | null = null;
	let headerSent = false;
	let done = false;

	// Only the content filter columns: prompts and completions are never read.
	// The literal IS NOT NULL matches the partial index's predicate.
	const readPage = async () =>
		await db
			.select({
				id: log.id,
				ts: createdAtText,
				requestId: log.requestId,
				organizationId: log.organizationId,
				projectId: log.projectId,
				apiKeyId: log.apiKeyId,
				usedModel: log.usedModel,
				usedProvider: log.usedProvider,
				evaluation: log.gatewayContentFilterEvaluation,
				response: log.gatewayContentFilterResponse,
			})
			.from(log)
			.where(
				and(
					sql`gateway_content_filter_response IS NOT NULL`,
					gte(log.createdAt, from),
					lt(log.createdAt, until),
					// A retried attempt logs the same verdicts as the attempt that
					// ends the request; keep the latter, with the model that served it.
					sql`${log.retried} IS NOT TRUE`,
					cursor
						? and(
								sql`${log.createdAt} >= ${cursor.ts}::timestamp`,
								sql`(${log.createdAt}, ${log.id}) > (${cursor.ts}::timestamp, ${cursor.id})`,
							)
						: undefined,
				),
			)
			.orderBy(asc(log.createdAt), asc(log.id))
			.limit(PAGE_SIZE);

	const toChecks = (row: ContentFilteredLogRow) =>
		internalClassifierChecksFromLog(row).filter(
			(check) => decision === "all" || check.decision === "block",
		);

	const encoder = new TextEncoder();
	// A failed page errors the stream, so the download fails instead of
	// ending early like a complete file.
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (!headerSent) {
				headerSent = true;
				controller.enqueue(
					encoder.encode(
						`${INTERNAL_CLASSIFIER_CHECK_CSV_HEADERS.join(",")}\n`,
					),
				);
				return;
			}
			if (done) {
				controller.close();
				return;
			}
			try {
				const rows = await readPage();
				if (rows.length < PAGE_SIZE) {
					done = true;
				} else {
					const last = rows[rows.length - 1]!;
					cursor = { ts: last.ts, id: last.id };
				}
				const checks = rows.flatMap(toChecks);
				if (checks.length > 0) {
					controller.enqueue(
						encoder.encode(
							`${checks.map(internalClassifierCheckCsvLine).join("\n")}\n`,
						),
					);
				}
			} catch (error) {
				logger.error(
					"Internal classifier check export failed",
					error instanceof Error ? error : new Error(String(error)),
				);
				controller.error(error);
			}
		},
	});

	const filename = `internal-classifier-checks-${decision}-${from.toISOString()}_to_${to.toISOString()}.csv`;
	return c.body(body, 200, {
		"Content-Type": "text/csv; charset=utf-8",
		"Content-Disposition": `attachment; filename="${filename}"`,
	});
});
