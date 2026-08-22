/* eslint-disable no-console */

const HASH_SECRET_ENV = "GATEWAY_API_KEY_HASH_SECRET";
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;

export interface KeyStorageBackfillOptions {
	batchSize: number;
	commit: boolean;
}

export function parseKeyStorageBackfillOptions(): KeyStorageBackfillOptions {
	const args = process.argv.slice(2);
	const unknown = args.filter(
		(arg) => arg !== "--commit" && !arg.startsWith("--batch-size="),
	);
	if (unknown.length > 0) {
		throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
	}

	const batchSizeArg = args.find((arg) => arg.startsWith("--batch-size="));
	const batchSize = batchSizeArg
		? Number(batchSizeArg.slice("--batch-size=".length))
		: DEFAULT_BATCH_SIZE;
	if (
		!Number.isInteger(batchSize) ||
		batchSize < 1 ||
		batchSize > MAX_BATCH_SIZE
	) {
		throw new Error(
			`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`,
		);
	}

	return {
		batchSize,
		commit: args.includes("--commit"),
	};
}

export function requireExplicitHashSecret(): void {
	const currentSecret = (process.env[HASH_SECRET_ENV] ?? "")
		.split(",")[0]
		?.trim();
	if (!currentSecret) {
		throw new Error(
			`${HASH_SECRET_ENV} must be explicitly set before running with --commit`,
		);
	}
}

export function describeDatabaseTarget(): string {
	const url = process.env.DATABASE_URL;
	if (!url) {
		return "local default (DATABASE_URL is not set)";
	}

	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname}`;
	} catch {
		return "unparseable DATABASE_URL";
	}
}

export function printKeyStorageBackfillHeader(
	options: KeyStorageBackfillOptions,
): void {
	console.log(`Database: ${describeDatabaseTarget()}`);
	console.log(
		`Mode: ${options.commit ? "COMMIT (writes enabled)" : "DRY RUN (no writes)"}`,
	);
	console.log(`Batch size: ${options.batchSize}`);
}
