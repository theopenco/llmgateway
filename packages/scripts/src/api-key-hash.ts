/* eslint-disable no-console */
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const API_KEY_HASH_SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";

function printUsage(): void {
	console.log(
		"Usage: pnpm --filter @llmgateway/scripts api-key-hash <api-key> [more-api-keys...]",
	);
	console.log("");
	console.log(
		`Uses ${API_KEY_HASH_SECRET_ENV} when set, otherwise falls back to the gateway's development default outside production.`,
	);
}

function main(): void {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		printUsage();
		return;
	}

	if (args.length === 0) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	for (const [index, apiKey] of args.entries()) {
		console.log(`key-${index + 1}\t${getApiKeyFingerprint(apiKey)}`);
	}
}

main();
