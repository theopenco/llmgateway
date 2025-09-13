import { writeFileSync } from "fs";

import { logger } from "@llmgateway/logger";

import { app, config } from "..";

async function generateOpenAPI() {
	const spec = app.getOpenAPIDocument(config);

	writeFileSync("openapi.json", JSON.stringify(spec, null, 2));
	logger.info("openapi.json has been generated");
	process.exit(0);
}

void generateOpenAPI().catch((err) => {
	logger.error(
		"Failed to generate OpenAPI",
		err instanceof Error ? err : new Error(String(err)),
	);
	process.exit(1);
});
