/* eslint-disable no-console */
import { createHmac } from "node:crypto";

const API_KEY_HASH_SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";
const DEV_API_KEY_HASH_SECRET = "llmgateway-dev-api-key-hash-secret";

function getApiKeyHashSecret(): string {
	const configuredSecret = process.env[API_KEY_HASH_SECRET_ENV]?.trim();
	if (configuredSecret) {
		return configuredSecret;
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			`${API_KEY_HASH_SECRET_ENV} is required in production to hash logged provider API keys`,
		);
	}

	return DEV_API_KEY_HASH_SECRET;
}

function getApiKeyFingerprint(token: string): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update(token)
		.digest("hex");
}

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
