// Read-only dump of content-filtered log rows in [FROM, TO) (UTC) as gzipped
// NDJSON on stdout, ending with {"__total": N}. Runs inside the worker image.
// Selects only the content filter columns: prompts and completions are never read.
"use strict";
const { createRequire } = require("module");
const zlib = require("zlib");

const r = createRequire("/app/package.json");
const { Client } = createRequire(r.resolve("@llmgateway/db"))("pg");

const FROM = process.env.FROM;
const TO = process.env.TO;
const PAGE = 2000;

(async () => {
	const c = new Client({
		connectionString: process.env.DATABASE_URL,
		statement_timeout: 120000,
		application_name: "internal-classifier-export",
	});
	await c.connect();
	await c.query("BEGIN READ ONLY");
	const gz = zlib.createGzip();
	gz.pipe(process.stdout);
	let cursor = null;
	let total = 0;
	for (;;) {
		const params = [FROM, TO];
		let after = "";
		if (cursor) {
			params.push(cursor.ts, cursor.id);
			after =
				"AND created_at >= $3::timestamp AND (created_at, id) > ($3::timestamp, $4)";
		}
		// IS NOT NULL matches log_content_filter_created_at_idx; retried attempts
		// repeat the final attempt's verdicts.
		const { rows } = await c.query(
			`SELECT id, created_at::text AS cursor_ts,
			        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts,
			        request_id, organization_id, project_id, api_key_id, used_model, used_provider,
			        gateway_content_filter_evaluation AS evaluation,
			        gateway_content_filter_response AS response
			 FROM log
			 WHERE gateway_content_filter_response IS NOT NULL
			   AND created_at >= $1::timestamp AND created_at < $2::timestamp
			   AND retried IS NOT TRUE ${after}
			 ORDER BY created_at, id LIMIT ${PAGE}`,
			params,
		);
		for (const row of rows) {
			const { cursor_ts: cursorTs, ...out } = row;
			void cursorTs;
			gz.write(`${JSON.stringify(out)}\n`);
		}
		total += rows.length;
		if (rows.length < PAGE) {
			break;
		}
		const last = rows[rows.length - 1];
		cursor = { ts: last.cursor_ts, id: last.id };
	}
	await c.query("ROLLBACK");
	await c.end();
	gz.end(`${JSON.stringify({ __total: total })}\n`);
})().catch((error) => {
	process.stderr.write(`${error && error.stack}\n`);
	process.exit(1);
});
