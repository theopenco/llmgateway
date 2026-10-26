import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import { and, asc, db, gte, lt, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

export const adminInternalClassifierChecks = new OpenAPIHono<ServerTypes>();

adminInternalClassifierChecks.use("/*", adminMiddleware);

const HOUR_MS = 60 * 60 * 1000;
const PAGE_SIZE = 5000;
const SETTLE_MS = 60_000;
// Every check is ~20k rows an hour, so the full export is capped at a day;
// blocks are a small share and span the whole retention window.
const MAX_RANGE_HOURS = { all: 24, block: 31 * 24 } as const;

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
				"Internal classifier checks created in [from, to) as CSV, every check or blocks only: the classifier's audit CSV columns (fingerprints included) followed by the request's project, key, model and content filter outcome.",
		},
	},
});

const table = tables.internalClassifierCheck;
// Microsecond ISO text: the export's ts and the keyset cursor, which a JS
// Date would round to milliseconds.
const createdAtText = sql<string>`to_char(${table.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type CheckRow = {
	ts: string;
	id: string;
} & Omit<typeof table.$inferSelect, "id" | "createdAt">;

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

export function internalClassifierCheckCsvLine(row: CheckRow): string {
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
	if (to.getTime() - from.getTime() > MAX_RANGE_HOURS[decision] * HOUR_MS) {
		throw new HTTPException(400, {
			message: `Range exceeds ${MAX_RANGE_HOURS[decision]} hours for decision=${decision}`,
		});
	}

	// Literal predicate so the planner can use the partial block index.
	const decisionFilter =
		decision === "block" ? sql`${table.decision} = 'block'` : undefined;
	// created_at is the inserting transaction's start; one that commits after
	// a page was read would land behind the cursor, so recent rows wait.
	const until = new Date(Math.min(to.getTime(), Date.now() - SETTLE_MS));
	let cursor: { ts: string; id: string } | null = null;
	let headerSent = false;
	let done = false;

	const readPage = async (): Promise<CheckRow[]> =>
		await db
			.select({
				ts: createdAtText,
				id: table.id,
				requestId: table.requestId,
				chunkIndex: table.chunkIndex,
				organizationId: table.organizationId,
				projectId: table.projectId,
				apiKeyId: table.apiKeyId,
				usedModel: table.usedModel,
				usedProvider: table.usedProvider,
				internalScope: table.internalScope,
				tier: table.tier,
				level: table.level,
				action: table.action,
				decision: table.decision,
				rule: table.rule,
				reasons: table.reasons,
				tags: table.tags,
				score: table.score,
				saltId: table.saltId,
				algoVersion: table.algoVersion,
				fpStatus: table.fpStatus,
				promptBytes: table.promptBytes,
				simhash: table.simhash,
				simhashGlobal: table.simhashGlobal,
				exactHash: table.exactHash,
				conversationKey: table.conversationKey,
				minhashB64: table.minhashB64,
				bandKeys: table.bandKeys,
			})
			.from(table)
			.where(
				and(
					gte(table.createdAt, from),
					lt(table.createdAt, until),
					decisionFilter,
					cursor
						? and(
								sql`${table.createdAt} >= ${cursor.ts}::timestamp`,
								sql`(${table.createdAt}, ${table.id}) > (${cursor.ts}::timestamp, ${cursor.id})`,
							)
						: undefined,
				),
			)
			.orderBy(asc(table.createdAt), asc(table.id))
			.limit(PAGE_SIZE);

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
				if (rows.length > 0) {
					controller.enqueue(
						encoder.encode(
							`${rows.map(internalClassifierCheckCsvLine).join("\n")}\n`,
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
