import { formatLintResults, lintMigrationsFolder } from "./migration-lint.js";

const results = lintMigrationsFolder("./migrations");
if (results.length > 0) {
	process.stderr.write(
		`${formatLintResults(results)}\n\nSee the migrations skill (.agents/skills/migrations/SKILL.md) for safe patterns.\n`,
	);
	process.exit(1);
}
process.stdout.write("Migration lint passed.\n");
