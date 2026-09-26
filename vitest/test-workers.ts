import os from "node:os";

/**
 * Per-worker test resources.
 *
 * Unit test files used to run one at a time (`--no-file-parallelism`) because
 * they all shared one Postgres database and one Redis. Rather than serialize
 * ~500 files, every vitest worker gets its own clone of the test database and
 * its own Redis logical database, which lets the files run in parallel.
 *
 * Redis ships with 16 logical databases, which is what caps the worker count.
 */
const MAX_TEST_WORKERS = 16;

export const TEST_WORKER_COUNT = Math.max(
	1,
	Math.min(MAX_TEST_WORKERS, os.availableParallelism() - 1),
);

/** 1-based id of the worker running the current file. */
export function testWorkerId(): number {
	const poolId = Number(process.env.VITEST_POOL_ID);
	if (!Number.isInteger(poolId) || poolId < 1) {
		return 1;
	}
	return Math.min(poolId, TEST_WORKER_COUNT);
}

/**
 * TEST_DATABASE_URL takes precedence so a worktree running an isolated stack
 * can export DATABASE_URL for its dev database without tests wiping it. CI
 * only sets DATABASE_URL (already pointing at the test database), so it keeps
 * working unchanged.
 */
export function resolveTestDatabaseUrl(): string {
	return (
		process.env.TEST_DATABASE_URL ??
		process.env.DATABASE_URL ??
		"postgres://postgres:pw@localhost:5432/test"
	);
}

// Worker database names are interpolated into CREATE/DROP DATABASE, which
// cannot take a parameter.
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function templateDatabaseName(url: URL): string {
	const name = decodeURIComponent(url.pathname.slice(1));
	if (!DATABASE_NAME_PATTERN.test(name)) {
		throw new Error(`Unsupported test database name ${JSON.stringify(name)}`);
	}
	return name;
}

export function workerDatabaseName(workerId: number): string {
	const url = new URL(resolveTestDatabaseUrl());
	return `${templateDatabaseName(url)}_w${workerId}`;
}

export function workerDatabaseUrl(workerId: number): string {
	const url = new URL(resolveTestDatabaseUrl());
	url.pathname = `/${workerDatabaseName(workerId)}`;
	return url.toString();
}

/** Template database plus the maintenance connection that can clone it. */
export function testDatabaseTemplate(): { adminUrl: string; name: string } {
	const url = new URL(resolveTestDatabaseUrl());
	const name = templateDatabaseName(url);
	url.pathname = "/postgres";
	return { adminUrl: url.toString(), name };
}
