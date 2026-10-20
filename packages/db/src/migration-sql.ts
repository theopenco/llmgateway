/**
 * Static analysis of Drizzle migration SQL: the index operations the
 * prebuilt-index guard checks, the tables a migration locks, and the lint rules
 * that keep a migration from taking long ACCESS EXCLUSIVE locks on live tables.
 */

export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Opts one index statement out of the prebuilt-index guard. */
export const ALLOW_BLOCKING_INDEX_MARKER = "-- migrate:allow-blocking-index";

/**
 * Acknowledges a lint finding. Must be followed by a reason, e.g.
 * `-- migrate:reviewed table has < 1k rows` or the manual step to run first.
 */
export const REVIEWED_MARKER = "-- migrate:reviewed";

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

const CREATE_INDEX_RE = new RegExp(
	String.raw`^\s*create\s+(unique\s+)?index\s+(concurrently\s+)?(if\s+not\s+exists\s+)?(${QUALIFIED})\s+on\s+(?:only\s+)?(${QUALIFIED})`,
	"i",
);
const DROP_INDEX_RE = new RegExp(
	String.raw`^\s*drop\s+index\s+(concurrently\s+)?(if\s+exists\s+)?(${QUALIFIED}(?:\s*,\s*${QUALIFIED})*)`,
	"i",
);
const CREATE_TABLE_RE = new RegExp(
	String.raw`^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})`,
	"i",
);
const ALTER_TABLE_RE = new RegExp(
	String.raw`^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})`,
	"i",
);
const LOCKING_TABLE_RES = [
	ALTER_TABLE_RE,
	new RegExp(
		String.raw`^\s*drop\s+table\s+(?:if\s+exists\s+)?(${QUALIFIED})`,
		"i",
	),
	new RegExp(
		String.raw`^\s*truncate\s+(?:table\s+)?(?:only\s+)?(${QUALIFIED})`,
		"i",
	),
	new RegExp(String.raw`^\s*update\s+(?:only\s+)?(${QUALIFIED})`, "i"),
	new RegExp(String.raw`^\s*delete\s+from\s+(?:only\s+)?(${QUALIFIED})`, "i"),
	new RegExp(String.raw`^\s*insert\s+into\s+(${QUALIFIED})`, "i"),
	CREATE_INDEX_RE,
];
const REFERENCES_RE = new RegExp(String.raw`references\s+(${QUALIFIED})`, "gi");
const VOLATILE_DEFAULT_RE =
	/\badd\s+column\b[\s\S]*\bdefault\s+[\s\S]*\b(random|gen_random_uuid|uuid_generate_v[14]|clock_timestamp|timeofday|nextval|txid_current)\s*\(/i;

export interface MigrationStatement {
	/** Statement text as written, comments included. */
	raw: string;
	/** Statement text with SQL comments removed. */
	sql: string;
}

export interface IndexOperation {
	kind: "create" | "drop";
	/** Index name as written (quoted identifiers keep their quotes). */
	name: string;
	/** Table the index is created on; absent for drops. */
	table?: string;
	ifExists: boolean;
	concurrently: boolean;
	statement: MigrationStatement;
}

export interface LintFinding {
	rule:
		| "create-index-if-not-exists"
		| "drop-index-if-exists"
		| "alter-column-type"
		| "set-not-null"
		| "foreign-key-not-valid"
		| "volatile-default"
		| "multi-table-lock";
	message: string;
	statement?: string;
}

function stripComments(sql: string): string {
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/--[^\n]*/g, " ")
		.trim();
}

export function splitStatements(migrationSql: string): MigrationStatement[] {
	return migrationSql
		.split(STATEMENT_BREAKPOINT)
		.flatMap((chunk) => {
			// A chunk can hold several statements; keep a statement's leading
			// comments attached to it so markers apply to the right one.
			const parts: string[] = [];
			let current = "";
			for (const line of chunk.split("\n")) {
				current += line + "\n";
				if (stripComments(line).endsWith(";")) {
					parts.push(current);
					current = "";
				}
			}
			parts.push(current);
			return parts;
		})
		.map((raw) => ({ raw: raw.trim(), sql: stripComments(raw) }))
		.filter((statement) => statement.sql.length > 0);
}

/** Normalizes an identifier the way Postgres resolves it. */
export function normalizeIdentifier(identifier: string): string {
	return identifier
		.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/)
		.map((part) =>
			part.startsWith('"')
				? part.slice(1, -1).replace(/""/g, '"')
				: part.toLowerCase(),
		)
		.join(".");
}

/** Unqualified, normalized relation name. */
export function relationName(identifier: string): string {
	const normalized = normalizeIdentifier(identifier);
	return normalized.slice(normalized.lastIndexOf(".") + 1);
}

/**
 * Qualifies an index name with its table's schema, as Postgres places an index
 * in the schema of its table and does not accept a qualified name in CREATE INDEX.
 */
export function qualifyIndexName(name: string, table: string): string {
	const parts = table.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/);
	if (parts.length < 2 || normalizeIdentifier(name).includes(".")) {
		return name;
	}
	return `${parts[0]}.${name}`;
}

function splitIdentifierList(list: string): string[] {
	return list
		.split(/\s*,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/)
		.map((part) => part.trim())
		.filter(Boolean);
}

export function hasMarker(
	statement: MigrationStatement,
	marker: string,
): boolean {
	return statement.raw
		.split("\n")
		.some((line) => line.trim().toLowerCase().startsWith(marker));
}

function hasReviewedReason(statements: MigrationStatement[]): boolean {
	return statements.some((statement) =>
		statement.raw.split("\n").some((line) => {
			const trimmed = line.trim();
			return (
				trimmed.toLowerCase().startsWith(REVIEWED_MARKER) &&
				trimmed.slice(REVIEWED_MARKER.length).replace(/^[:\s]+/, "").length > 0
			);
		}),
	);
}

export function parseIndexOperations(migrationSql: string): IndexOperation[] {
	const operations: IndexOperation[] = [];
	for (const statement of splitStatements(migrationSql)) {
		const create = CREATE_INDEX_RE.exec(statement.sql);
		if (create) {
			operations.push({
				kind: "create",
				name: create[4],
				table: create[5],
				ifExists: Boolean(create[3]),
				concurrently: Boolean(create[2]),
				statement,
			});
			continue;
		}
		const drop = DROP_INDEX_RE.exec(statement.sql);
		if (drop) {
			for (const name of splitIdentifierList(drop[3])) {
				operations.push({
					kind: "drop",
					name,
					ifExists: Boolean(drop[2]),
					concurrently: Boolean(drop[1]),
					statement,
				});
			}
		}
	}
	return operations;
}

/** Tables created by this migration (normalized, unqualified). */
export function createdTables(migrationSql: string): Set<string> {
	const tables = new Set<string>();
	for (const statement of splitStatements(migrationSql)) {
		const match = CREATE_TABLE_RE.exec(statement.sql);
		if (match) {
			tables.add(relationName(match[1]));
		}
	}
	return tables;
}

/**
 * Tables a migration takes a lock on, as written (normalized, unqualified):
 * altered, dropped, written to, indexed, or referenced by a new foreign key.
 */
export function touchedTables(migrationSql: string): Set<string> {
	const tables = new Set<string>();
	for (const statement of splitStatements(migrationSql)) {
		for (const re of LOCKING_TABLE_RES) {
			const match = re.exec(statement.sql);
			if (match) {
				// CREATE INDEX captures its table last; every other pattern first.
				tables.add(relationName(re === CREATE_INDEX_RE ? match[5] : match[1]));
				break;
			}
		}
		if (/^\s*(alter|create)\s+table\b/i.test(statement.sql)) {
			for (const ref of statement.sql.matchAll(REFERENCES_RE)) {
				tables.add(relationName(ref[1]));
			}
		}
	}
	return tables;
}

/** Rewrites a CREATE INDEX statement into its non-blocking form. */
export function toConcurrentCreateIndex(statementSql: string): string {
	return (
		statementSql
			.replace(/;\s*$/, "")
			.replace(
				/^\s*create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?/i,
				(_, unique: string | undefined) =>
					`CREATE ${unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS `,
			) + ";"
	);
}

export function toConcurrentDropIndex(name: string): string {
	return `DROP INDEX CONCURRENTLY IF EXISTS ${name};`;
}

/**
 * Lints one migration for statements that hold ACCESS EXCLUSIVE locks on live
 * tables for longer than a catalog update. Statements on tables the migration
 * creates itself are exempt. Findings other than the IF [NOT] EXISTS rules are
 * acknowledged with a `-- migrate:reviewed <reason>` comment on the statement
 * (or, for multi-table-lock, anywhere in the migration).
 */
export function lintMigrationSql(migrationSql: string): LintFinding[] {
	const statements = splitStatements(migrationSql);
	const created = createdTables(migrationSql);
	const findings: LintFinding[] = [];
	const lockedExisting = new Set<string>();
	const isNew = (identifier: string) => created.has(relationName(identifier));

	for (const statement of statements) {
		const { sql } = statement;
		const reviewed = hasReviewedReason([statement]);

		const create = CREATE_INDEX_RE.exec(sql);
		if (create) {
			if (!isNew(create[5]) && !create[3]) {
				findings.push({
					rule: "create-index-if-not-exists",
					message:
						"CREATE INDEX on an existing table must use IF NOT EXISTS so it can be prebuilt CONCURRENTLY before deploy.",
					statement: sql,
				});
			}
			continue;
		}

		const drop = DROP_INDEX_RE.exec(sql);
		if (drop) {
			if (!drop[2]) {
				findings.push({
					rule: "drop-index-if-exists",
					message:
						"DROP INDEX must use IF EXISTS so it can be dropped CONCURRENTLY before deploy.",
					statement: sql,
				});
			}
			continue;
		}

		const alter = ALTER_TABLE_RE.exec(sql);
		if (!alter || isNew(alter[1])) {
			continue;
		}
		lockedExisting.add(relationName(alter[1]));
		if (reviewed) {
			continue;
		}

		if (/\balter\s+column\s+\S+\s+(?:set\s+data\s+)?type\b/i.test(sql)) {
			findings.push({
				rule: "alter-column-type",
				message:
					"ALTER COLUMN ... TYPE rewrites the table under ACCESS EXCLUSIVE. Use expand/contract (new column, backfill, swap) or justify with -- migrate:reviewed <reason>.",
				statement: sql,
			});
		}
		if (/\bset\s+not\s+null\b/i.test(sql)) {
			findings.push({
				rule: "set-not-null",
				message:
					"SET NOT NULL scans the table under ACCESS EXCLUSIVE. Add a CHECK (col IS NOT NULL) NOT VALID constraint, VALIDATE it separately, then SET NOT NULL; or justify with -- migrate:reviewed <reason>.",
				statement: sql,
			});
		}
		if (/\bforeign\s+key\b/i.test(sql) && !/\bnot\s+valid\b/i.test(sql)) {
			findings.push({
				rule: "foreign-key-not-valid",
				message:
					"Adding a FOREIGN KEY validates every row while locking both tables. Add it NOT VALID and VALIDATE CONSTRAINT in a later migration, or justify with -- migrate:reviewed <reason>.",
				statement: sql,
			});
		}
		if (VOLATILE_DEFAULT_RE.test(sql)) {
			findings.push({
				rule: "volatile-default",
				message:
					"ADD COLUMN with a volatile DEFAULT rewrites the table. Add the column without a default and backfill in batches, or justify with -- migrate:reviewed <reason>.",
				statement: sql,
			});
		}
	}

	if (lockedExisting.size > 1 && !hasReviewedReason(statements)) {
		findings.push({
			rule: "multi-table-lock",
			message: `One migration alters ${lockedExisting.size} existing tables (${[...lockedExisting].join(", ")}) and holds every ACCESS EXCLUSIVE lock until it commits. Split it into one migration per table across PRs, or justify with -- migrate:reviewed <reason>.`,
		});
	}

	return findings;
}
