import { runMigrateCli } from "./migrate.js";

// `pnpm migrate` applies pending migrations; `pnpm migrate --check` is a
// read-only preflight.
// Exit explicitly: the imported Redis client would keep the process alive.
process.exit(await runMigrateCli(process.argv.slice(2)));
