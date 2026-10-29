import { runMigrateCli } from "@llmgateway/db";

// Image entry point for running migrations as a one-off job before rollout:
// `node dist/migrate.js` applies, `node dist/migrate.js --check` preflights.
// Exit explicitly: the imported Redis client would keep the process alive.
process.exit(await runMigrateCli(process.argv.slice(2)));
