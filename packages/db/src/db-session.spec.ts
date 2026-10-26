import { afterAll, describe, expect, it } from "vitest";

import { databaseApplicationName, getPoolStats, pool } from "./db.js";
import { setQueryTags } from "./query-tags.js";

describe("database sessions", () => {
	afterAll(() => {
		setQueryTags({});
	});

	it("carry lock and idle-transaction limits and a traceable application_name", async () => {
		setQueryTags({ application: "db-session-spec" });
		// A fresh connection picks up the application name set after import.
		const client = await pool.connect();
		try {
			const result = await client.query<{
				lock_timeout: string;
				idle: string;
				application_name: string;
			}>(
				"select current_setting('lock_timeout') as lock_timeout, current_setting('idle_in_transaction_session_timeout') as idle, current_setting('application_name') as application_name",
			);
			expect(result.rows[0]).toMatchObject({
				lock_timeout: "10s",
				idle: "1min",
			});
			expect(result.rows[0].application_name).toMatch(/^db-session-spec\//);
			expect(databaseApplicationName()).toMatch(/^db-session-spec\//);
		} finally {
			client.release(true);
		}
	});

	it("reports pool occupancy", async () => {
		const client = await pool.connect();
		try {
			const stats = getPoolStats();
			expect(stats.total).toBeGreaterThanOrEqual(1);
			expect(stats.total - stats.idle).toBeGreaterThanOrEqual(1);
			expect(stats.max).toBe(pool.options.max);
		} finally {
			client.release();
		}
	});
});
