import process from "node:process";
import { setTimeout } from "node:timers/promises";

import { processPendingVideoJobs } from "../../worker/dist/services/video-jobs.js";

if (!process.env.STACK_SUFFIX || !process.env.GATEWAY_PORT) {
	throw new Error(
		"Load an isolated stack environment before starting the video worker.",
	);
}

async function run() {
	while (true) {
		await processPendingVideoJobs();
		await setTimeout(1000);
	}
}
void run().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.stack : String(error)}\n`,
	);
	process.exitCode = 1;
});
