import type { SystemRule } from "@/types.js";

const DOCUMENT_LEAKAGE_PATTERNS = [
	// Internal/confidential markers
	/\b(internal\s+use\s+only|confidential|proprietary|trade\s+secret)\b/i,
	// Classification markers
	// Bare "secret", "restricted" and "draft" are everyday words.
	/\b(top\s+secret|classified\s+(information|document|material)|secret\s*\/\/\s*noforn)\b/i,
	// Common corporate document markers
	/\b(do\s+not\s+(share|distribute|forward)|not\s+for\s+(public|external)\s+(use|distribution))\b/i,
	// Legal markers
	/\b(attorney[- ]client\s+privilege|legally\s+privileged|work\s+product)\b/i,
	// NDA markers
	/\b(under\s+nda|non[- ]?disclosure|covered\s+by\s+agreement)\b/i,
	// Draft markers (may indicate unfinished internal docs)
	/\b(internal\s+draft|for\s+internal\s+review|not\s+for\s+release)\b/i,
];

export const documentLeakageRule: SystemRule = {
	id: "system:document_leakage",
	name: "Document Leakage Prevention",
	category: "document_leakage",
	defaultEnabled: false,
	defaultAction: "warn",
	redactable: false,
	trustedRoles: "scan",
	check: (content) => {
		const matches: string[] = [];
		for (const pattern of DOCUMENT_LEAKAGE_PATTERNS) {
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
