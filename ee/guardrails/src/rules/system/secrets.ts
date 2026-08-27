import {
	findMatches,
	isPlaceholderSecret,
	redactMatches,
	shannonEntropy,
} from "./detector.js";

import type { Detector } from "./detector.js";
import type { SystemRule } from "@/types.js";

const SECRET_REPLACEMENT = "[SECRET_REDACTED]";

const AWS_SECRET_CONTEXT =
	/(aws.{0,16}secret|secret.{0,4}access.{0,4}key|secret.{0,4}key)\W{0,8}$/i;

/**
 * Opaque 40-character blobs are the single biggest false-positive source: git
 * SHAs, checksums, base64 payloads and content hashes all have that shape.
 * Only report one when the surrounding text names an AWS secret, or when the
 * value itself looks like a random key (mixed case + digits, high entropy, not
 * a hex digest).
 */
function looksLikeAwsSecret(value: string, before: string): boolean {
	if (AWS_SECRET_CONTEXT.test(before)) {
		return true;
	}
	if (/^[0-9a-f]+$/i.test(value) || /^[0-9]+$/.test(value)) {
		return false;
	}
	if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
		return false;
	}
	return shannonEntropy(value) >= 4.2;
}

/**
 * `key = value` in the shapes credentials actually appear in: bare, quoted, or
 * as a JSON property. Only the value is captured, so redaction replaces the
 * secret and leaves the surrounding quotes and punctuation intact — replacing
 * the whole match would turn `{"password":"hunter2"}` into invalid JSON. The
 * quoted branches come first so a value containing a comma is captured whole.
 */
const ASSIGNED_VALUE = `["']?\\s*[=:]\\s*(?:"([^"\\n]{8,})"|'([^'\\n]{8,})'|([^\\s'",;]{8,}))`;

const SECRET_DETECTORS: Detector[] = [
	{
		id: "private_key",
		label: "Private Key",
		replacement: SECRET_REPLACEMENT,
		pattern:
			/-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE\s+KEY-----/,
	},
	{
		id: "aws_access_key_id",
		label: "AWS Access Key",
		replacement: SECRET_REPLACEMENT,
		pattern: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/,
	},
	{
		id: "github_token",
		label: "GitHub Token",
		replacement: SECRET_REPLACEMENT,
		pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
	},
	{
		id: "slack_token",
		label: "Slack Token",
		replacement: SECRET_REPLACEMENT,
		pattern: /\bxox[baprs]-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{24,}\b/,
	},
	{
		id: "stripe_key",
		label: "Stripe Key",
		replacement: SECRET_REPLACEMENT,
		pattern: /\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{24,}\b/,
	},
	{
		id: "openai_key",
		label: "OpenAI Key",
		replacement: SECRET_REPLACEMENT,
		pattern: /\bsk-[A-Za-z0-9]{48,}\b/,
	},
	{
		id: "jwt",
		label: "JWT",
		replacement: SECRET_REPLACEMENT,
		// Every segment must be non-empty; the previous `*` quantifiers matched
		// bare words such as `eyJ..`.
		pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/,
	},
	{
		id: "bearer_token",
		label: "Bearer Token",
		replacement: SECRET_REPLACEMENT,
		pattern:
			/\bBearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_.-])/,
	},
	{
		id: "connection_string",
		label: "Connection String",
		replacement: SECRET_REPLACEMENT,
		pattern:
			/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@[^\s]+/i,
		validate: (value) => !isPlaceholderSecret(value.split(":")[2] ?? ""),
	},
	{
		id: "aws_secret_access_key",
		label: "AWS Secret Key",
		replacement: SECRET_REPLACEMENT,
		pattern: /\b[A-Za-z0-9/+=]{40}\b/,
		validate: (value, before) => looksLikeAwsSecret(value, before),
	},
	{
		id: "api_key",
		label: "API Key",
		replacement: SECRET_REPLACEMENT,
		pattern: new RegExp(
			`\\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)${ASSIGNED_VALUE}`,
			"i",
		),
		redactGroup: true,
		validate: (value) =>
			!isPlaceholderSecret(value) && shannonEntropy(value) >= 3,
	},
	{
		id: "password",
		label: "Password",
		replacement: SECRET_REPLACEMENT,
		// Also matches the JSON shape `"password": "hunter2"`, which the previous
		// pattern missed because of the quote before the colon.
		pattern: new RegExp(`\\b(?:password|passwd|pwd)${ASSIGNED_VALUE}`, "i"),
		redactGroup: true,
		validate: (value) => !isPlaceholderSecret(value),
	},
];

export function detectSecrets(content: string): {
	patterns: string[];
	matches: string[];
} {
	const found = findMatches(content, SECRET_DETECTORS);
	return {
		patterns: found.map((m) => m.detector.label),
		matches: found.map((m) => m.value),
	};
}

export function redactSecrets(content: string): {
	redacted: string;
	patterns: string[];
} {
	const found = findMatches(content, SECRET_DETECTORS);
	return {
		redacted: redactMatches(content, found),
		patterns: found.map((m) => m.detector.label),
	};
}

export const secretsRule: SystemRule = {
	id: "system:secrets",
	name: "Secrets Detection",
	category: "secrets",
	defaultEnabled: true,
	defaultAction: "block",
	check: (content, config) => {
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		// Report the detector labels, never the matched values: the engine
		// persists these on the violation record, and a head/tail truncation
		// still leaks 15 characters of a 40-character key.
		const { patterns } = detectSecrets(content);

		return {
			passed: patterns.length === 0,
			matches: patterns,
		};
	},
};
