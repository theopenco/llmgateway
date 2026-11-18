import type { ContentFilterBlockGroup } from "./content-filter.js";

/**
 * Content filter groups whose flagged requests keep their raw payload in
 * `content_filter_flagged_payload` for trust & safety review and NCMEC reports.
 */
export const FLAGGED_PAYLOAD_GROUPS = [
	"csam",
	"sexual",
] as const satisfies readonly ContentFilterBlockGroup[];

/** Groups still preserved while a zero-data-retention policy is active. */
export const FLAGGED_PAYLOAD_ZDR_GROUPS = [
	"csam",
] as const satisfies readonly ContentFilterBlockGroup[];

/** How long a flagged payload is kept when it is not reported. */
export const FLAGGED_PAYLOAD_RETENTION_DAYS = 90;

/** 18 U.S.C. 2258A(h): report contents are preserved for one year after a report. */
export const FLAGGED_PAYLOAD_REPORTED_RETENTION_DAYS = 365;

/** Cap on the stored plaintext; the oldest messages are dropped first. */
export const MAX_FLAGGED_PAYLOAD_BYTES = 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = FLAGGED_PAYLOAD_RETENTION_DAYS * DAY_MS;
const REPORTED_RETENTION_MS = FLAGGED_PAYLOAD_REPORTED_RETENTION_DAYS * DAY_MS;

export function getFlaggedPayloadExpiry(createdAt: Date): Date {
	return new Date(createdAt.getTime() + RETENTION_MS);
}

/** Expiry once reported; never earlier than the current one. */
export function getReportedFlaggedPayloadExpiry(
	reportedAt: Date,
	currentExpiresAt: Date,
): Date {
	const reported = new Date(reportedAt.getTime() + REPORTED_RETENTION_MS);
	return reported > currentExpiresAt ? reported : currentExpiresAt;
}

export interface FlaggedPayloadImage {
	type: "image";
	/** Remote URL as the client sent it; unset for inline images. */
	url?: string;
	/** SHA-256 of the decoded inline bytes; the bytes are never stored. */
	sha256?: string;
	mimeType?: string;
	bytes?: number;
}

export interface FlaggedPayloadBinary {
	type: "audio" | "file";
	sha256?: string;
	mimeType?: string;
	bytes?: number;
	filename?: string;
	fileId?: string;
}

export type FlaggedPayloadPart =
	| { type: "text"; text: string }
	| FlaggedPayloadImage
	| FlaggedPayloadBinary
	| { type: "tool_use"; name: string; input: unknown }
	| { type: "tool_result"; content: unknown }
	| { type: "other"; originalType: string };

export interface FlaggedPayloadMessage {
	role: string;
	name?: string;
	content: string | FlaggedPayloadPart[];
	toolCalls?: { name: string; arguments: string }[];
}

/** Decrypted shape of `content_filter_flagged_payload.payload_ciphertext`. */
export interface FlaggedPayload {
	version: 1;
	messages: FlaggedPayloadMessage[];
	/** Messages dropped from the start to fit {@link MAX_FLAGGED_PAYLOAD_BYTES}. */
	droppedMessages: number;
}
