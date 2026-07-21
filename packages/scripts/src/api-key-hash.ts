/* eslint-disable no-console */
/**
 * Print the HMAC-SHA256 fingerprints of one or more gateway API keys.
 *
 * The pnpm entry runs plain `tsx` without `--env-file`, so the script only
 * sees env vars you export/prefix. When GATEWAY_API_KEY_HASH_SECRET is unset
 * it falls back to the dev default outside production.
 *
 * Hash specific keys (run from repo root):
 *
 *   GATEWAY_API_KEY_HASH_SECRET='your-secret' \
 *     pnpm --filter @llmgateway/scripts api-key-hash llmgtwy_abc llmgtwy_def
 *
 * Hash every API key in the local database:
 *
 *   export GATEWAY_API_KEY_HASH_SECRET='your-secret'
 *   psql "$DATABASE_URL" -Atc 'select token from api_key' \
 *     | xargs pnpm --filter @llmgateway/scripts api-key-hash
 *
 * Output rows are only labeled key-1, key-2, ... in argument order; to print
 * each token next to its hash:
 *
 *   psql "$DATABASE_URL" -Atc 'select token from api_key' > /tmp/tokens.txt
 *   xargs pnpm --filter @llmgateway/scripts api-key-hash < /tmp/tokens.txt \
 *     | cut -f2 | paste /tmp/tokens.txt -
 */
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
