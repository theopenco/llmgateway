#!/usr/bin/env node
/**
 * Registers derived forms of the e2e credentials with the Actions log masker.
 *
 * GitHub only masks a secret's exact value. A credential env var holding a
 * comma-separated list, or a service-account JSON whose `private_key` is
 * printed on its own, never matches that value and would reach the log in
 * plaintext. Emitting `::add-mask::` for each derived form closes the gap.
 *
 * Standalone on purpose: it runs before anything is built.
 */

/**
 * Kept in step with `vitest/redact-credentials.ts` — `redact-credentials.spec.ts`
 * asserts the two agree. Duplicated rather than imported so this stays runnable
 * before anything is built.
 *
 * `LLM_*` is the provider-credential namespace and is treated as secret by
 * default: `LLM_RUNPOD_KEY` carries a real key and matches none of the naming
 * patterns below.
 */
const LLM_CONFIG_SUFFIX_PATTERN =
	/_(BASE_URL|REGION|PROJECT|RESOURCE|API_VERSION|DEPLOYMENT_TYPE|USE_RESPONSES_API|WORKSPACE_ID|TOKEN_TYPE|MODE|METHOD|MODELS|KEYWORDS|THRESHOLD|BUCKET|PREFIX|COUNT|TTL_SECONDS)$/;

const CREDENTIAL_NAME_PATTERN =
	/(API_KEY|TOKEN|SECRET|PASSWORD|SERVICE_ACCOUNT_JSON)/;

function isCredentialEnvName(name) {
	// Variant and regional overrides (`__ENTERPRISE`, `__EU_FRANKFURT`) share
	// the base variable's meaning.
	const base = name.split("__")[0];
	if (base.startsWith("LLM_")) {
		return !LLM_CONFIG_SUFFIX_PATTERN.test(base);
	}
	return CREDENTIAL_NAME_PATTERN.test(name);
}
const MIN_SECRET_LENGTH = 12;

/** Split on top-level commas only, so a service-account JSON stays one entry. */
function splitTopLevel(value) {
	const entries = [];
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

const masks = new Set();

function add(value) {
	const trimmed = typeof value === "string" ? value.trim() : "";
	// A mask value may not span lines: the runner would treat only the first
	// line as the command and echo the rest verbatim. Multi-line values are
	// registered line by line instead.
	if (trimmed.length >= MIN_SECRET_LENGTH && !/[\r\n]/.test(trimmed)) {
		masks.add(trimmed);
	}
}

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
		// A non-JSON entry is an ordinary key and is already masked above.
		let parsed;
		try {
			parsed = JSON.parse(part);
		} catch {
			continue;
		}
		if (typeof parsed.private_key === "string") {
			add(parsed.private_key);
			// The PEM body appears with its newlines either escaped or expanded.
			for (const line of parsed.private_key
				.split("\\n")
				.flatMap((chunk) => chunk.split("\n"))) {
				add(line);
			}
		}
	}
}

for (const mask of masks) {
	process.stdout.write(`::add-mask::${mask}\n`);
}

process.stdout.write(`Registered ${masks.size} derived credential mask(s).\n`);
