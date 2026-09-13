import { inspect } from "node:util";

/**
 * Keeps provider credentials out of test console output.
 *
 * CI uploads the vitest blob reports as workflow artifacts, and GitHub only
 * masks secrets in *logs* — artifact contents are copied verbatim and are
 * downloadable by anyone for a public repository. Masking also misses values
 * derived from a secret (a single comma-separated key out of a list, the
 * `private_key` of a service-account JSON), which never match the registered
 * string. Redacting at the console boundary covers both.
 */

/**
 * `LLM_*` is the provider-credential namespace, so it is treated as secret by
 * default: `LLM_RUNPOD_KEY` carries a real key and matches none of the naming
 * patterns below. Only the catalogue's non-secret knobs are exempt, and a
 * missing exemption costs a redacted config value in test output — the
 * opposite mistake costs a credential.
 */
const LLM_CONFIG_SUFFIX_PATTERN =
	/_(BASE_URL|REGION|PROJECT|RESOURCE|API_VERSION|DEPLOYMENT_TYPE|USE_RESPONSES_API|WORKSPACE_ID|TOKEN_TYPE|MODE|METHOD|MODELS|KEYWORDS|THRESHOLD|BUCKET|PREFIX|COUNT|TTL_SECONDS)$/;

const CREDENTIAL_NAME_PATTERN =
	/(API_KEY|TOKEN|SECRET|PASSWORD|SERVICE_ACCOUNT_JSON)/;

export function isCredentialEnvName(name: string): boolean {
	// Variant and regional overrides (`__ENTERPRISE`, `__EU_FRANKFURT`) share
	// the base variable's meaning.
	const base = name.split("__")[0];
	if (base.startsWith("LLM_")) {
		return !LLM_CONFIG_SUFFIX_PATTERN.test(base);
	}
	return CREDENTIAL_NAME_PATTERN.test(name);
}

/** Short values are config (`true`, `dev`), not credentials, and redacting
 * them would hide the seeded `test-token` fixtures the suites assert on. */
const MIN_SECRET_LENGTH = 12;

const PLACEHOLDER = "[REDACTED]";

const CONSOLE_METHODS = [
	"log",
	"info",
	"warn",
	"error",
	"debug",
	"trace",
] as const;

/**
 * Split a credential env var the way the gateway does: on top-level commas
 * only, so the commas inside a service-account JSON stay part of one entry.
 */
function splitTopLevel(value: string): string[] {
	const entries: string[] = [];
	let current = "";
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (const char of value) {
		if (escaped) {
			current += char;
			escaped = false;
		} else if (inString) {
			current += char;
			if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
		} else if (char === '"') {
			inString = true;
			current += char;
		} else if (char === "{") {
			depth++;
			current += char;
		} else if (char === "}") {
			depth = Math.max(0, depth - 1);
			current += char;
		} else if (char === "," && depth === 0) {
			entries.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	entries.push(current);
	return entries;
}

export function collectCredentialValues(): string[] {
	const secrets = new Set<string>();

	const add = (value: string | undefined) => {
		const trimmed = value?.trim();
		if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) {
			secrets.add(trimmed);
		}
	};

	for (const [name, value] of Object.entries(process.env)) {
		if (!value || !isCredentialEnvName(name)) {
			continue;
		}
		add(value);
		for (const entry of splitTopLevel(value)) {
			const part = entry.trim();
			add(part);
			if (!part.startsWith("{")) {
				continue;
			}
			// A non-JSON entry is an ordinary key; it is already covered by `add`.
			let parsed: unknown;
			try {
				parsed = JSON.parse(part);
			} catch {
				continue;
			}
			const privateKey = (parsed as { private_key?: unknown }).private_key;
			if (typeof privateKey === "string") {
				add(privateKey);
				// The PEM body survives JSON round-trips with its newlines either
				// escaped or expanded; both forms have to go.
				for (const line of privateKey
					.split("\\n")
					.flatMap((l) => l.split("\n"))) {
					add(line);
				}
			}
		}
	}

	// Longest first so a full env value is replaced before one of its entries.
	return [...secrets].sort((a, b) => b.length - a.length);
}

let cache: { fingerprint: string; secrets: string[] } | null = null;

/** Credential env vars are often set after the setup file runs, so the secret
 * list is rebuilt whenever the set of candidate variables changes. */
function envFingerprint(): string {
	let fingerprint = "";
	for (const [name, value] of Object.entries(process.env)) {
		if (value && isCredentialEnvName(name)) {
			fingerprint += `${name}:${value.length},`;
		}
	}
	return fingerprint;
}

function currentSecrets(): string[] {
	const fingerprint = envFingerprint();
	if (!cache || cache.fingerprint !== fingerprint) {
		cache = { fingerprint, secrets: collectCredentialValues() };
	}
	return cache.secrets;
}

export function redactCredentials(text: string): string {
	let redacted = text;
	for (const secret of currentSecrets()) {
		if (redacted.includes(secret)) {
			redacted = redacted.split(secret).join(PLACEHOLDER);
		}
	}
	return redacted;
}

function redactArgument(arg: unknown): unknown {
	if (typeof arg === "string") {
		return redactCredentials(arg);
	}
	const rendered = inspect(arg, { depth: null });
	const redacted = redactCredentials(rendered);
	return redacted === rendered ? arg : redacted;
}

let installed = false;

export function installConsoleCredentialRedaction(): void {
	if (installed) {
		return;
	}
	installed = true;

	for (const method of CONSOLE_METHODS) {
		/* eslint-disable no-console -- wrapping the console is the point here. */
		const original = console[method].bind(console);
		console[method] = (...args: unknown[]) => {
			if (currentSecrets().length === 0) {
				original(...args);
				return;
			}
			original(...args.map(redactArgument));
		};
		/* eslint-enable no-console */
	}
}
