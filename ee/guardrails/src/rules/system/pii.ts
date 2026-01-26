import type { SystemRule } from "@/types.js";

const PII_PATTERNS = [
	// SSN
	/\b\d{3}-\d{2}-\d{4}\b/,
	// Credit card numbers
	/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
	// Email addresses
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
	// Phone numbers (various formats)
	/\b(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/,
	// IP addresses
	/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/,
	// Passport numbers (simplified)
	/\b[A-Z]{1,2}[0-9]{6,9}\b/,
	// Driver's license (simplified, US format)
	/\b[A-Z]{1,2}[0-9]{5,8}\b/,
];

const PII_REPLACEMENTS: Record<string, string> = {
	ssn: "[SSN_REDACTED]",
	credit_card: "[CREDIT_CARD_REDACTED]",
	email: "[EMAIL_REDACTED]",
	phone: "[PHONE_REDACTED]",
	ip_address: "[IP_REDACTED]",
	passport: "[PASSPORT_REDACTED]",
	drivers_license: "[LICENSE_REDACTED]",
};

export function redactPii(content: string): {
	redacted: string;
	patterns: string[];
} {
	let redacted = content;
	const patterns: string[] = [];

	// SSN
	const ssnMatches = redacted.match(/\b\d{3}-\d{2}-\d{4}\b/g);
	if (ssnMatches) {
		patterns.push(...ssnMatches.map(() => "SSN"));
		redacted = redacted.replace(/\b\d{3}-\d{2}-\d{4}\b/g, PII_REPLACEMENTS.ssn);
	}

	// Credit cards
	const ccPattern =
		/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g;
	const ccMatches = redacted.match(ccPattern);
	if (ccMatches) {
		patterns.push(...ccMatches.map(() => "Credit Card"));
		redacted = redacted.replace(ccPattern, PII_REPLACEMENTS.credit_card);
	}

	// Email
	const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
	const emailMatches = redacted.match(emailPattern);
	if (emailMatches) {
		patterns.push(...emailMatches.map(() => "Email"));
		redacted = redacted.replace(emailPattern, PII_REPLACEMENTS.email);
	}

	// Phone
	const phonePattern =
		/\b(?:\+1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g;
	const phoneMatches = redacted.match(phonePattern);
	if (phoneMatches) {
		patterns.push(...phoneMatches.map(() => "Phone"));
		redacted = redacted.replace(phonePattern, PII_REPLACEMENTS.phone);
	}

	// IP addresses
	const ipPattern =
		/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
	const ipMatches = redacted.match(ipPattern);
	if (ipMatches) {
		patterns.push(...ipMatches.map(() => "IP Address"));
		redacted = redacted.replace(ipPattern, PII_REPLACEMENTS.ip_address);
	}

	return { redacted, patterns };
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

		const matches: string[] = [];
		for (const pattern of PII_PATTERNS) {
			const match = content.match(pattern);
			if (match) {
				matches.push(match[0]);
			}
		}

		return {
			passed: matches.length === 0,
			matches,
		};
	},
};
