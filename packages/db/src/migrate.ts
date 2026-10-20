import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, DatabaseError } from "pg";

import { logger } from "@llmgateway/logger";

import { clearRowCaches } from "./cache-reset.js";
import {
	ALLOW_BLOCKING_INDEX_MARKER,
	STATEMENT_BREAKPOINT,
	createdTables,
	hasMarker,
	parseIndexOperations,
	qualifyIndexName,
	relationName,
	toConcurrentCreateIndex,
	toConcurrentDropIndex,
	touchedTables,
} from "./migration-sql.js";
import { SCHEMA_CACHE_VERSION } from "./schema-cache-version.js";

import type { MigrationMeta } from "drizzle-orm/migrator";

export interface MigrationOptions {
	databaseUrl?: string;
	migrationsFolder?: string;
	migrationsSchema?: string;
	migrationsTable?: string;
	/** Per-statement lock wait before a migration attempt gives up. */
	lockTimeoutMs?: number;
	/** Per-statement runtime cap; 0 disables. */
	statementTimeoutMs?: number;
	/** Attempts per migration when it loses a lock wait or deadlock. */
	maxAttempts?: number;
	retryBaseDelayMs?: number;
	/** Refuse to run pending index changes that were not prebuilt CONCURRENTLY. */
	requirePrebuiltIndexes?: boolean;
	/** How long to wait for another runner to finish before failing. */
	runnerLockWaitMs?: number;
	/** `--check` flags locks held by transactions open at least this long. */
	maxTransactionAgeS?: number;
	clearCaches?: boolean;
}

type ResolvedMigrationOptions = Required<MigrationOptions>;

export interface LockHolder {
	pid: number;
	applicationName: string;
	user: string;
	state: string | null;
	table: string;
	mode: string;
	granted: boolean;
	transactionAgeS: number;
	query: string;
}

export interface IndexProblem {
	migration: string;
	index: string;
	problem: "missing" | "invalid" | "present";
	commands: string[];
}

export interface MigrationCheckResult {
	ok: boolean;
	pending: string[];
	indexProblems: IndexProblem[];
	blockers: LockHolder[];
}

const DEFAULT_DATABASE_URL = "postgres://postgres:pw@localhost:5432/db";
const RETRY_MAX_DELAY_MS = 30_000;
const SLOW_MIGRATION_WARNING_MS = 60_000;
// Advisory lock pair ("llmg", "migr") serializing concurrent runners, e.g.
// several API replicas starting with RUN_MIGRATIONS=true.
const RUNNER_LOCK = [0x6c6c6d67, 0x6d696772] as const;
const LOCK_NOT_AVAILABLE = "55P03";
const DEADLOCK_DETECTED = "40P01";

function envNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function resolveMigrationOptions(
	options: MigrationOptions = {},
): ResolvedMigrationOptions {
	return {
		databaseUrl:
			options.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
		// The API image copies packages/db/migrations next to its dist/.
		migrationsFolder: options.migrationsFolder ?? "./migrations",
		migrationsSchema: options.migrationsSchema ?? "drizzle",
		migrationsTable: options.migrationsTable ?? "__drizzle_migrations",
		lockTimeoutMs:
			options.lockTimeoutMs ?? envNumber("MIGRATIONS_LOCK_TIMEOUT_MS", 5000),
		statementTimeoutMs:
			options.statementTimeoutMs ??
			envNumber("MIGRATIONS_STATEMENT_TIMEOUT_MS", 15 * 60_000),
		maxAttempts: Math.max(
			1,
			options.maxAttempts ?? envNumber("MIGRATIONS_MAX_ATTEMPTS", 5),
		),
		retryBaseDelayMs: options.retryBaseDelayMs ?? 1000,
		requirePrebuiltIndexes:
			options.requirePrebuiltIndexes ??
			process.env.MIGRATIONS_REQUIRE_PREBUILT_INDEXES === "true",
		runnerLockWaitMs:
			options.runnerLockWaitMs ??
			envNumber("MIGRATIONS_RUNNER_LOCK_WAIT_MS", 15 * 60_000),
		maxTransactionAgeS:
			options.maxTransactionAgeS ??
			envNumber("MIGRATIONS_CHECK_MAX_TRANSACTION_AGE_S", 30),
		clearCaches: options.clearCaches ?? true,
	};
}

function quoteIdent(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

function bookkeepingTable(o: ResolvedMigrationOptions): string {
	return `${quoteIdent(o.migrationsSchema)}.${quoteIdent(o.migrationsTable)}`;
}

function migrationSql(migration: MigrationMeta): string {
	return migration.sql.join(STATEMENT_BREAKPOINT);
}

async function connect(o: ResolvedMigrationOptions): Promise<Client> {
	const client = new Client({
		connectionString: o.databaseUrl,
		// Names the session in pg_stat_activity so a stuck migration and the
		// sessions it waits on can be told apart from app traffic.
		application_name: `llmgateway-migrate/${hostname()}`.slice(0, 63),
		lock_timeout: o.lockTimeoutMs,
		statement_timeout: o.statementTimeoutMs,
		idle_in_transaction_session_timeout: 60_000,
	});
	client.on("error", (error) => {
		logger.error("Migration database connection error", error);
	});
	await client.connect();
	return client;
}

async function endClient(client: Client): Promise<void> {
	try {
		await client.end();
	} catch (error) {
		logger.error(
			"Error closing migration database connection",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

interface AppliedMigrations {
	exists: boolean;
	/** False for a pre-1.0 Drizzle table that still tracks hashes only. */
	hasNames: boolean;
	names: Set<string>;
	hashes: Set<string>;
}

async function readApplied(
	client: Client,
	o: ResolvedMigrationOptions,
): Promise<AppliedMigrations> {
	const columns = await client.query<{ column_name: string }>(
		`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
		[o.migrationsSchema, o.migrationsTable],
	);
	if (columns.rows.length === 0) {
		return {
			exists: false,
			hasNames: true,
			names: new Set(),
			hashes: new Set(),
		};
	}
	const hasNames = columns.rows.some((row) => row.column_name === "name");
	const rows = await client.query<{ hash: string; name: string | null }>(
		`select hash, ${hasNames ? "name" : "null as name"} from ${bookkeepingTable(o)}`,
	);
	return {
		exists: true,
		hasNames,
		names: new Set(
			rows.rows.flatMap((row) => (row.name === null ? [] : [row.name])),
		),
		hashes: new Set(rows.rows.map((row) => row.hash)),
	};
}

function pendingMigrations(
	local: MigrationMeta[],
	applied: AppliedMigrations,
): MigrationMeta[] {
	return local.filter((migration) =>
		applied.hasNames
			? !applied.names.has(migration.name)
			: !applied.hashes.has(migration.hash),
	);
}

/**
 * Sessions holding (or waiting for) a lock on any of `tables` inside a
 * transaction open at least `minTransactionAgeS` seconds.
 */
export async function findLockHolders(
	client: Client,
	tables: string[],
	minTransactionAgeS: number,
): Promise<LockHolder[]> {
	if (tables.length === 0) {
		return [];
	}
	const result = await client.query<{
		pid: number;
		application_name: string;
		usename: string;
		state: string | null;
		relname: string;
		mode: string;
		granted: boolean;
		xact_age_s: number;
		query: string;
	}>(
		`select a.pid, a.application_name, a.usename, a.state, c.relname, l.mode, l.granted,
			floor(extract(epoch from now() - a.xact_start))::int as xact_age_s,
			left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 300) as query
		from pg_locks l
		join pg_class c on c.oid = l.relation
		join pg_namespace n on n.oid = c.relnamespace
		join pg_stat_activity a on a.pid = l.pid
		where l.locktype = 'relation'
			and c.relname = any($1::text[])
			and n.nspname not in ('pg_catalog', 'information_schema')
			and a.pid <> pg_backend_pid()
			and a.xact_start <= now() - make_interval(secs => $2)
		order by xact_age_s desc, a.pid`,
		[tables, minTransactionAgeS],
	);
	return result.rows.map((row) => ({
		pid: row.pid,
		applicationName: row.application_name,
		user: row.usename,
		state: row.state,
		table: row.relname,
		mode: row.mode,
		granted: row.granted,
		transactionAgeS: row.xact_age_s,
		query: row.query,
	}));
}

async function relationExists(client: Client, name: string): Promise<boolean> {
	const result = await client.query<{ present: boolean }>(
		"select to_regclass($1) is not null as present",
		[name],
	);
	return result.rows[0]?.present === true;
}

async function indexState(
	client: Client,
	name: string,
): Promise<"absent" | "valid" | "invalid"> {
	const result = await client.query<{ valid: boolean }>(
		"select indisvalid as valid from pg_index where indexrelid = to_regclass($1)",
		[name],
	);
	const row = result.rows[0];
	if (!row) {
		return "absent";
	}
	return row.valid ? "valid" : "invalid";
}

/**
 * Index changes in pending migrations that would build or drop an index on a
 * live table inside the migration transaction. Exempt: tables the migration
 * creates or that do not exist yet, statements already CONCURRENTLY, and
 * statements marked `-- migrate:allow-blocking-index`.
 */
export async function findIndexProblems(
	client: Client,
	pending: MigrationMeta[],
): Promise<IndexProblem[]> {
	const problems: IndexProblem[] = [];
	for (const migration of pending) {
		const sql = migrationSql(migration);
		const created = createdTables(sql);
		for (const op of parseIndexOperations(sql)) {
			if (
				op.concurrently ||
				hasMarker(op.statement, ALLOW_BLOCKING_INDEX_MARKER)
			) {
				continue;
			}
			const name = op.table ? qualifyIndexName(op.name, op.table) : op.name;
			const state = await indexState(client, name);
			if (op.kind === "drop") {
				if (state !== "absent") {
					problems.push({
						migration: migration.name,
						index: op.name,
						problem: "present",
						commands: [toConcurrentDropIndex(op.name)],
					});
				}
				continue;
			}
			if (
				!op.table ||
				created.has(relationName(op.table)) ||
				!(await relationExists(client, op.table))
			) {
				continue;
			}
			if (state === "absent") {
				problems.push({
					migration: migration.name,
					index: name,
					problem: "missing",
					commands: [toConcurrentCreateIndex(op.statement.sql)],
				});
			} else if (state === "invalid") {
				problems.push({
					migration: migration.name,
					index: name,
					problem: "invalid",
					commands: [
						toConcurrentDropIndex(name),
						toConcurrentCreateIndex(op.statement.sql),
					],
				});
			}
		}
	}
	return problems;
}

export function formatIndexProblems(problems: IndexProblem[]): string {
	const describe: Record<IndexProblem["problem"], string> = {
		missing: "must be built before deploy",
		invalid: "exists but is INVALID (a failed CONCURRENTLY build); rebuild it",
		present: "must be dropped before deploy",
	};
	return [
		"Pending migrations change indexes on live tables. Run these outside a transaction (e.g. psql, not a migration), then deploy again:",
		...problems.flatMap((problem) => [
			`-- ${problem.migration}: ${problem.index} ${describe[problem.problem]}`,
			...problem.commands,
		]),
	].join("\n");
}

export function formatLockHolders(holders: LockHolder[]): string {
	return holders
		.map(
			(holder) =>
				`pid ${holder.pid} (${holder.applicationName || "no application_name"}, ${holder.user}, ${holder.state ?? "unknown"}) ${holder.granted ? "holds" : "waits for"} ${holder.mode} on ${holder.table}, transaction open ${holder.transactionAgeS}s: ${holder.query}`,
		)
		.join("\n");
}

function isRetryableLockError(error: unknown): boolean {
	return (
		error instanceof DatabaseError &&
		(error.code === LOCK_NOT_AVAILABLE || error.code === DEADLOCK_DETECTED)
	);
}

async function applyMigration(
	client: Client,
	migration: MigrationMeta,
	o: ResolvedMigrationOptions,
): Promise<void> {
	await client.query("BEGIN");
	try {
		for (const statement of migration.sql) {
			if (statement.trim()) {
				await client.query(statement);
			}
		}
		await client.query(
			`insert into ${bookkeepingTable(o)} ("hash", "created_at", "name") values ($1, $2, $3)`,
			[migration.hash, migration.folderMillis, migration.name],
		);
		await client.query("COMMIT");
	} catch (error) {
		try {
			await client.query("ROLLBACK");
		} catch (rollbackError) {
			logger.error(
				"Rolling back failed migration failed",
				rollbackError instanceof Error
					? rollbackError
					: new Error(String(rollbackError)),
				{ migration: migration.name },
			);
		}
		throw error;
	}
}

/**
 * Applies one migration in its own transaction. A lost lock wait (lock_timeout)
 * or deadlock rolls the migration back and retries with backoff, so a
 * migration never queues app traffic behind its ACCESS EXCLUSIVE request for
 * longer than one lock_timeout.
 */
async function applyWithRetry(
	client: Client,
	migration: MigrationMeta,
	o: ResolvedMigrationOptions,
): Promise<void> {
	const tables = [...touchedTables(migrationSql(migration))];
	for (let attempt = 1; ; attempt++) {
		const startedAt = Date.now();
		// Alerting keys on this line: a migration still running after a minute
		// is holding its locks far longer than a schema change should.
		const slowWarning = setInterval(() => {
			logger.warn("Migration still running", {
				migration: migration.name,
				attempt,
				elapsedMs: Date.now() - startedAt,
			});
		}, SLOW_MIGRATION_WARNING_MS);
		try {
			await applyMigration(client, migration, o);
			logger.info("Applied migration", {
				migration: migration.name,
				attempt,
				durationMs: Date.now() - startedAt,
			});
			return;
		} catch (error) {
			clearInterval(slowWarning);
			if (!isRetryableLockError(error)) {
				throw error;
			}
			let holders: LockHolder[] = [];
			try {
				holders = await findLockHolders(client, tables, 0);
			} catch (diagnosticError) {
				logger.error(
					"Could not list lock holders for a blocked migration",
					diagnosticError instanceof Error
						? diagnosticError
						: new Error(String(diagnosticError)),
				);
			}
			const context = {
				migration: migration.name,
				attempt,
				maxAttempts: o.maxAttempts,
				lockTimeoutMs: o.lockTimeoutMs,
				blockers: formatLockHolders(holders),
			};
			if (attempt >= o.maxAttempts) {
				logger.error(
					"Migration could not acquire its locks, giving up",
					error instanceof Error ? error : new Error(String(error)),
					context,
				);
				throw error;
			}
			const backoffFactor = 2 ** (attempt - 1);
			const delayMs = Math.min(
				o.retryBaseDelayMs * backoffFactor,
				RETRY_MAX_DELAY_MS,
			);
			logger.warn("Migration blocked by a lock, retrying", {
				...context,
				delayMs,
			});
			await sleep(delayMs);
		} finally {
			clearInterval(slowWarning);
		}
	}
}

async function acquireRunnerLock(
	client: Client,
	o: ResolvedMigrationOptions,
): Promise<void> {
	const deadline = Date.now() + o.runnerLockWaitMs;
	let logged = false;
	for (;;) {
		const result = await client.query<{ locked: boolean }>(
			"select pg_try_advisory_lock($1, $2) as locked",
			[...RUNNER_LOCK],
		);
		if (result.rows[0]?.locked === true) {
			return;
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`Another migration runner held the migration lock for over ${o.runnerLockWaitMs}ms`,
			);
		}
		if (!logged) {
			logger.info("Waiting for another migration runner to finish");
			logged = true;
		}
		await sleep(1000);
	}
}

async function ensureBookkeepingTable(
	client: Client,
	o: ResolvedMigrationOptions,
): Promise<void> {
	await client.query(
		`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(o.migrationsSchema)}`,
	);
	// Same shape Drizzle's migrator creates, so either can run against it.
	await client.query(
		`CREATE TABLE IF NOT EXISTS ${bookkeepingTable(o)} (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint,
			name text,
			applied_at timestamp with time zone DEFAULT now()
		)`,
	);
}

/**
 * Applies pending migrations from `migrationsFolder`, each in its own
 * transaction, on a dedicated connection with lock_timeout and
 * statement_timeout set. Returns the names of the applied migrations.
 */
export async function runMigrations(
	options: MigrationOptions = {},
): Promise<string[]> {
	const o = resolveMigrationOptions(options);

	logger.info("Starting database migrations", {
		schemaCacheVersion: SCHEMA_CACHE_VERSION,
		lockTimeoutMs: o.lockTimeoutMs,
		statementTimeoutMs: o.statementTimeoutMs,
		requirePrebuiltIndexes: o.requirePrebuiltIndexes,
	});

	const local = readMigrationFiles({ migrationsFolder: o.migrationsFolder });
	const client = await connect(o);
	const applied: string[] = [];
	try {
		await acquireRunnerLock(client, o);

		const existing = await readApplied(client, o);
		if (existing.exists && !existing.hasNames) {
			// Pre-1.0 Drizzle bookkeeping (hash-only). Drizzle's migrator upgrades
			// the table in place, applying pending migrations in one transaction.
			logger.warn(
				"Legacy migration bookkeeping table found; upgrading it with Drizzle's migrator",
			);
			const pending = pendingMigrations(local, existing);
			await migrate(drizzle({ client }), {
				migrationsFolder: o.migrationsFolder,
				migrationsSchema: o.migrationsSchema,
				migrationsTable: o.migrationsTable,
			});
			applied.push(...pending.map((migration) => migration.name));
		} else {
			await ensureBookkeepingTable(client, o);
			const pending = pendingMigrations(local, existing);

			if (o.requirePrebuiltIndexes && pending.length > 0) {
				const problems = await findIndexProblems(client, pending);
				if (problems.length > 0) {
					throw new Error(formatIndexProblems(problems));
				}
			}

			for (const migration of pending) {
				await applyWithRetry(client, migration, o);
				applied.push(migration.name);
			}
		}

		logger.info("Database migrations completed successfully", {
			applied: applied.length,
		});
	} catch (error) {
		logger.error(
			"Database migration failed",
			error instanceof Error ? error : new Error(String(error)),
			{ applied },
		);
		throw error;
	} finally {
		// Ending the session also releases the runner advisory lock.
		await endClient(client);
	}

	// A migration changes the shape of the rows already sitting in Redis, so
	// drop them rather than let them be served against the new schema.
	if (applied.length > 0 && o.clearCaches) {
		await clearRowCaches();
	}
	return applied;
}

/**
 * Read-only preflight for pending migrations: index changes that were not
 * prebuilt, and transactions open longer than `maxTransactionAgeS` holding
 * locks on tables the pending migrations touch.
 */
export async function checkMigrations(
	options: MigrationOptions = {},
): Promise<MigrationCheckResult> {
	const o = resolveMigrationOptions(options);
	const local = readMigrationFiles({ migrationsFolder: o.migrationsFolder });
	const client = await connect(o);
	try {
		await client.query("SET default_transaction_read_only = on");
		const pending = pendingMigrations(local, await readApplied(client, o));
		const indexProblems = await findIndexProblems(client, pending);
		const tables = new Set(
			pending.flatMap((migration) => [
				...touchedTables(migrationSql(migration)),
			]),
		);
		const blockers = (
			await findLockHolders(client, [...tables], o.maxTransactionAgeS)
		).filter((holder) => holder.granted);
		return {
			ok: indexProblems.length === 0 && blockers.length === 0,
			pending: pending.map((migration) => migration.name),
			indexProblems,
			blockers,
		};
	} finally {
		await endClient(client);
	}
}

/** Entry point for `pnpm migrate [--check]` and the API image's migrate job. */
export async function runMigrateCli(argv: string[]): Promise<number> {
	if (!argv.includes("--check")) {
		await runMigrations();
		return 0;
	}

	const result = await checkMigrations();
	const out: string[] = [
		result.pending.length === 0
			? "No pending migrations."
			: `Pending migrations:\n${result.pending.map((name) => `  ${name}`).join("\n")}`,
	];
	if (result.indexProblems.length > 0) {
		out.push(formatIndexProblems(result.indexProblems));
	}
	if (result.blockers.length > 0) {
		out.push(
			`Long-running transactions hold locks on tables the pending migrations touch. Wait for them or terminate them (pg_terminate_backend(pid)) before deploying:\n${formatLockHolders(result.blockers)}`,
		);
	}
	out.push(result.ok ? "Migration check passed." : "Migration check failed.");
	process.stdout.write(out.join("\n\n") + "\n");
	return result.ok ? 0 : 1;
}
