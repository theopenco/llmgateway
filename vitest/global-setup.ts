import { Client } from "pg";

import {
	TEST_WORKER_COUNT,
	testDatabaseTemplate,
	workerDatabaseName,
} from "./test-workers.js";

/**
 * Give every vitest worker its own clone of the pushed test database.
 *
 * `CREATE DATABASE ... TEMPLATE` needs the template to have no other sessions,
 * so this has to run in global setup — the only point at which no worker is
 * connected yet. The clone is cheap because `pnpm push-test` puts schema only
 * in that database; seed data lives in the dev database.
 */
export default async function setup(): Promise<void> {
	const template = testDatabaseTemplate();
	const client = new Client({ connectionString: template.adminUrl });
	await client.connect();
	try {
		for (let workerId = 1; workerId <= TEST_WORKER_COUNT; workerId++) {
			const name = workerDatabaseName(workerId);
			await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			await client.query(
				`CREATE DATABASE "${name}" TEMPLATE "${template.name}"`,
			);
		}
	} finally {
		await client.end();
	}
}
