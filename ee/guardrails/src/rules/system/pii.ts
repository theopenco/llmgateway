import { findMatches, luhn, redactMatches } from "./detector.js";

import type { Detector } from "./detector.js";
import type { SystemRule } from "@/types.js";

/**
 * Builds a check for a keyword appearing on *either* side of the match, so both
 * "passport AB1234567" and "AB1234567 is my passport" are recognised.
 */
function nearKeyword(
	keywords: string,
): (before: string, after: string) => boolean {
	const before = new RegExp(`(?:${keywords})\\W{0,24}$`, "i");
	const after = new RegExp(
		`^\\W{0,4}(?:(?:is|was|are|were)\\s+)?(?:(?:my|the|his|her|their|our)\\s+)?(?:${keywords})`,
		"i",
	);
	return (b, a) => before.test(b) || after.test(a);
}

const nearPhone = nearKeyword(
	"phone|telephone|tel|mobile|cell|fax|whatsapp|sms|call me|reach me|contact",
);
const nearPassport = nearKeyword("passport|travel document");
const nearLicense = nearKeyword(
	"driver'?s?\\s*licen[cs]e|driving\\s*licen[cs]e|dl\\s*(?:no|number|#)",
);

const VERSION_CONTEXT =
	/(version|release|build|schema|firmware|\bv)\W{0,8}$|[\d.]$/i;

interface CardBrand {
	prefix: RegExp;
	lengths: number[];
}

const CARD_BRANDS: CardBrand[] = [
	{ prefix: /^4/, lengths: [13, 16, 19] },
	{ prefix: /^(?:5[1-5]|2[2-7])/, lengths: [16] },
	{ prefix: /^3[47]/, lengths: [15] },
	{ prefix: /^(?:6011|65\d{2}|64[4-9]\d)/, lengths: [16, 19] },
	{ prefix: /^3(?:0[0-5]|[689])/, lengths: [14] },
	{ prefix: /^35(?:2[89]|[3-8]\d)/, lengths: [16, 19] },
];

/**
 * A digit run is a card number only if its length matches the issuing brand's
 * prefix and it passes the Luhn checksum. Grouping separators are stripped
 * first, so `4111 1111 1111 1111` is caught alongside the unbroken form.
 */
function isCardNumber(value: string): boolean {
	const digits = value.replace(/[ -]/g, "");
	if (!/^\d+$/.test(digits)) {
		return false;
	}
	const brand = CARD_BRANDS.find(
		(candidate) =>
			candidate.prefix.test(digits) &&
			candidate.lengths.includes(digits.length),
	);
	return brand !== undefined && luhn(digits);
}

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
		id: "credit_card_grouped",
		label: "Credit Card",
		replacement: "[CREDIT_CARD_REDACTED]",
		// Listed before the unbroken form so the whole grouped span is replaced.
		pattern: /\b\d{4}[ -]\d{4,6}[ -]\d{4,6}(?:[ -]\d{1,4})?\b/,
		validate: (value) => isCardNumber(value),
	},
	{
		id: "credit_card",
		label: "Credit Card",
		replacement: "[CREDIT_CARD_REDACTED]",
		pattern: /\b\d{13,19}\b/,
		// Without brand and checksum validation every long digit run starting
		// with 4 or 5 is reported as a card number.
		validate: (value) => isCardNumber(value),
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
		validate: (value, before, after) =>
			/[-.\s()+]/.test(value) || nearPhone(before, after),
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
		validate: (_value, before, after) => nearPassport(before, after),
	},
	{
		id: "drivers_license",
		label: "Drivers License",
		replacement: "[LICENSE_REDACTED]",
		pattern: /\b[A-Z]{1,2}[0-9]{5,8}\b/,
		validate: (_value, before, after) => nearLicense(before, after),
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

		// Report the detector labels, never the matched values: the engine
		// persists these on the violation record.
		const { patterns } = detectPii(content);

		return {
			passed: patterns.length === 0,
			matches: patterns,
		};
	},
};
