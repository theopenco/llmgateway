import { randomInt } from "node:crypto";

import { BATCH_ENDPOINTS, type BatchEndpoint } from "@llmgateway/models";

import { getClientIpHeaderName } from "./client-ip.js";

export { BATCH_ENDPOINTS, type BatchEndpoint } from "@llmgateway/models";

export const BATCH_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const BATCH_MAX_REQUESTS = 50_000;
export const BATCH_COMPLETION_WINDOW = "24h";
export const BATCH_COMPLETION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BATCH_FILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const BATCH_SOURCE = "llmgateway-batch";
/** Larger upstream responses fail their line instead of being stored. */
export const BATCH_MAX_STORED_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * `error.code` values the gateway returns when an API key or team member
 * reached a spend limit. The batch worker waits for these to reset instead of
 * failing the batch.
 */
export const API_KEY_USAGE_LIMIT_ERROR_CODE = "api_key_usage_limit_exceeded";
export const MEMBER_BUDGET_EXCEEDED_ERROR_CODE = "member_budget_exceeded";

const MAX_REPORTED_ERRORS = 100;
const MAX_CUSTOM_ID_LENGTH = 512;
const ID_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomId(length = 24): string {
	let id = "";
	for (let index = 0; index < length; index++) {
		id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
	}
	return id;
}

export const newBatchFileId = () => `file-${randomId()}`;
export const newBatchId = () => `batch_${randomId()}`;
export const newBatchRequestId = () => `batch_req_${randomId()}`;

export function isBatchEndpoint(value: unknown): value is BatchEndpoint {
	return (
		typeof value === "string" &&
		(BATCH_ENDPOINTS as readonly string[]).includes(value)
	);
}

export interface BatchLineError {
	code: string;
	message: string;
	param?: string | null;
	line?: number | null;
}

export interface ParsedBatchRequest {
	lineNumber: number;
	customId: string;
	body: string;
}

export type ParsedBatchInput =
	| { ok: true; requests: ParsedBatchRequest[] }
	| { ok: false; errors: BatchLineError[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a Batch API input file (one JSON request per line, OpenAI format)
 * for the batch's endpoint. Blank lines are ignored.
 */
export function parseBatchInput(
	content: string,
	endpoint: BatchEndpoint,
): ParsedBatchInput {
	const errors: BatchLineError[] = [];
	const requests: ParsedBatchRequest[] = [];
	const customIds = new Set<string>();
	const fail = (
		line: number,
		code: string,
		message: string,
		param?: string,
	) => {
		if (errors.length < MAX_REPORTED_ERRORS) {
			errors.push({ code, message, param: param ?? null, line });
		}
	};

	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index].trim();
		const line = index + 1;
		if (raw === "") {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			fail(line, "invalid_json_line", "This line is not valid JSON.");
			continue;
		}
		if (!isPlainObject(parsed)) {
			fail(line, "invalid_request", "Each line must be a JSON object.");
			continue;
		}
		const { custom_id: customId, method, url, body } = parsed;
		if (
			typeof customId !== "string" ||
			customId.length === 0 ||
			customId.length > MAX_CUSTOM_ID_LENGTH ||
			customId.includes("\u0000")
		) {
			fail(
				line,
				"invalid_custom_id",
				`custom_id must be a non-empty string of at most ${MAX_CUSTOM_ID_LENGTH} characters without NUL characters.`,
				"custom_id",
			);
			continue;
		}
		if (customIds.has(customId)) {
			fail(
				line,
				"duplicate_custom_id",
				`The custom_id ${JSON.stringify(customId)} appears more than once.`,
				"custom_id",
			);
			continue;
		}
		if (method !== "POST") {
			fail(line, "invalid_method", "method must be POST.", "method");
			continue;
		}
		if (url !== endpoint) {
			fail(
				line,
				"mismatched_url",
				`url must be ${endpoint}, the endpoint of this batch.`,
				"url",
			);
			continue;
		}
		if (!isPlainObject(body)) {
			fail(line, "invalid_body", "body must be a JSON object.", "body");
			continue;
		}
		if (body.stream === true) {
			fail(
				line,
				"streaming_unsupported",
				"Streaming is not supported in batches.",
				"body.stream",
			);
			continue;
		}
		customIds.add(customId);
		requests.push({ lineNumber: line, customId, body: JSON.stringify(body) });
	}

	if (errors.length === 0 && requests.length === 0) {
		fail(1, "empty_file", "The input file contains no requests.");
	}
	if (requests.length > BATCH_MAX_REQUESTS) {
		fail(
			1,
			"too_many_requests",
			`A batch can hold at most ${BATCH_MAX_REQUESTS} requests.`,
		);
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true, requests };
}

export interface BatchOutputRow {
	id: string;
	customId: string;
	responseStatus: number | null;
	responseBody: string | null;
	requestId: string | null;
	error: { code: string; message: string } | null;
}

/**
 * One line of an output or error file. The upstream body is embedded verbatim
 * (it is stored as JSON text), so `bytes` computed from these lines matches
 * what the content endpoint serves.
 */
export function buildBatchOutputLine(row: BatchOutputRow): string {
	const response =
		row.responseStatus === null
			? "null"
			: `{"status_code":${row.responseStatus},"request_id":${JSON.stringify(row.requestId)},"body":${row.responseBody ?? "null"}}`;
	return `{"id":${JSON.stringify(row.id)},"custom_id":${JSON.stringify(row.customId)},"response":${response},"error":${JSON.stringify(row.error)}}\n`;
}

/**
 * Headers the worker sends with each batch request: the creating key, the
 * batch request id as `x-request-id`, the batch log source and the creator's
 * client IP so IP rules still apply.
 */
export function batchGatewayHeaders(options: {
	token: string;
	requestId: string;
	clientIp: string | null;
}): Record<string, string> {
	return {
		Authorization: `Bearer ${options.token}`,
		"Content-Type": "application/json",
		"x-request-id": options.requestId,
		"x-source": BATCH_SOURCE,
		...(options.clientIp
			? { [getClientIpHeaderName()]: options.clientIp }
			: {}),
	};
}

/** Stores an upstream response body as JSON text for {@link buildBatchOutputLine}. */
export function toStoredResponseBody(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text));
	} catch {
		return JSON.stringify(text);
	}
}
