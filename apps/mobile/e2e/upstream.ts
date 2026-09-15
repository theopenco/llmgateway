import process from "node:process";

import { startMockServer } from "../../gateway/dist/test-utils/mock-openai-server.js";

if (!process.env.STACK_SUFFIX || !process.env.GATEWAY_PORT) {
	throw new Error(
		"Load an isolated stack environment before starting the mock provider.",
	);
}

void startMockServer(Number(process.env.GATEWAY_PORT) + 8).catch(
	(error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
		);
		process.exitCode = 1;
	},
);
