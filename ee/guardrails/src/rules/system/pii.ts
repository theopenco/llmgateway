import { findMatches, luhn, redactMatches } from "./detector.js";

import type { Detector } from "./detector.js";
import type { SystemRule } from "@/types.js";

const PHONE_CONTEXT =
	/(phone|telephone|tel|mobile|cell|fax|whatsapp|sms|call me|reach me|contact)\W{0,16}$/i;
const PASSPORT_CONTEXT = /(passport|travel document)\W{0,24}$/i;
const LICENSE_CONTEXT =
	/(driver'?s?\s*licen[cs]e|driving\s*licen[cs]e|\bdl\s*(no|number|#)?)\W{0,24}$/i;
const VERSION_CONTEXT =
	/(version|release|build|schema|firmware|\bv)\W{0,8}$|[\d.]$/i;

/**
 * Ordered by specificity: an SSN or card number must win over the looser phone
 * detector when their spans overlap.
 */
const PII_DETECTORS: Detector[] = [
	{
		id: "ssn",
		label: "SSN",
		replacement: "[SSN_REDACTED]",
		// Structurally invalid area/group/serial blocks are never issued.
		pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/,
	},
	{
		id: "credit_card",
		label: "Credit Card",
		replacement: "[CREDIT_CARD_REDACTED]",
		pattern:
			/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
		// Without the checksum every 13/16-digit identifier starting with 4 or 5
		// is reported as a card number.
		validate: (value) => luhn(value),
	},
	{
		id: "email",
		label: "Email",
		replacement: "[EMAIL_REDACTED]",
		pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/,
	},
	{
		id: "phone",
		label: "Phone",
		replacement: "[PHONE_REDACTED]",
		pattern: /\b(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/,
		// A bare 10-digit run is far more often an id, an order number or a unix
		// timestamp than a phone number, so require either formatting (grouping
		// separators, parentheses, country code) or a nearby phone keyword.
		validate: (value, before) =>
			/[-.\s()+]/.test(value) || PHONE_CONTEXT.test(before),
	},
	{
		id: "ip_address",
		label: "IP Address",
		replacement: "[IP_REDACTED]",
		pattern:
			/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/,
		// `\b` does not stop at a dot, so a dotted version or a 5-part number
		// would otherwise yield an "IP" from its first four segments.
		validate: (value, before, after) =>
			!VERSION_CONTEXT.test(before) && !/^[.\d]/.test(after),
	},
	{
		id: "passport",
		label: "Passport",
		replacement: "[PASSPORT_REDACTED]",
		pattern: /\b[A-Z]{1,2}[0-9]{6,9}\b/,
		// Identical in shape to order numbers, SKUs and part numbers, so only
		// treat it as a passport when the surrounding text says so.
		validate: (_value, before) => PASSPORT_CONTEXT.test(before),
	},
	{
		id: "drivers_license",
		label: "Drivers License",
		replacement: "[LICENSE_REDACTED]",
		pattern: /\b[A-Z]{1,2}[0-9]{5,8}\b/,
		validate: (_value, before) => LICENSE_CONTEXT.test(before),
	},
];

export function detectPii(content: string): {
	patterns: string[];
	matches: string[];
} {
	const found = findMatches(content, PII_DETECTORS);
	return {
		patterns: found.map((m) => m.detector.label),
		matches: found.map((m) => m.value),
	};
}

export function redactPii(content: string): {
	redacted: string;
	patterns: string[];
} {
	const found = findMatches(content, PII_DETECTORS);
	return {
		redacted: redactMatches(content, found),
		patterns: found.map((m) => m.detector.label),
	};
}

export const piiRule: SystemRule = {
	id: "system:pii_detection",
	name: "PII Detection",
	category: "pii",
	defaultEnabled: true,
	defaultAction: "redact",
	check: (content, config) => {
		if (!config.enabled) {
			return { passed: true, matches: [] };
		}

		const { matches } = detectPii(content);

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
