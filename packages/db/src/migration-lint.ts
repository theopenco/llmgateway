import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { lintMigrationSql, type LintFinding } from "./migration-sql.js";

/**
 * Migrations older than this were written before the lint existed and have
 * already run in production; they are not re-checked.
 */
export const MIGRATION_LINT_SINCE = "20261020000000";

export interface MigrationLintResult {
	migration: string;
	findings: LintFinding[];
}

export function lintMigrationsFolder(
	migrationsFolder: string,
	since: string = MIGRATION_LINT_SINCE,
): MigrationLintResult[] {
	return readdirSync(migrationsFolder)
		.filter((name) => name.slice(0, 14) >= since)
		.filter((name) => existsSync(join(migrationsFolder, name, "migration.sql")))
		.sort()
		.map((name) => ({
			migration: name,
			findings: lintMigrationSql(
				readFileSync(join(migrationsFolder, name, "migration.sql"), "utf8"),
			),
		}))
		.filter((result) => result.findings.length > 0);
}

export function formatLintResults(results: MigrationLintResult[]): string {
	return results
		.flatMap(({ migration, findings }) =>
			findings.map(
				(finding) =>
					`${migration}: [${finding.rule}] ${finding.message}${finding.statement ? `\n  ${finding.statement.replace(/\s+/g, " ")}` : ""}`,
			),
		)
		.join("\n");
}
