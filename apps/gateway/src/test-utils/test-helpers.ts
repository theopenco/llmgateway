import { processLogQueue } from "worker";

import { RESPONSES_STORAGE_KEY_PREFIX } from "@/responses/tools/response-state.js";

import { redisClient } from "@llmgateway/cache";
import { db, inArray, tables, eq } from "@llmgateway/db";

/**
 * Reset Redis state between tests, except the Responses API state store.
 *
 * Test files run in parallel and the e2e suites run their tests concurrently,
 * all against a single Redis (the storage Redis falls back to the main
 * instance unless a STORAGE_REDIS_* var is set). A blanket `flushdb` therefore
 * fires while sibling tests are mid-conversation and deletes the responses
 * they stored, which surfaces as a follow-up `previous_response_id` turn
 * losing its history or `GET /v1/responses/:id` returning 404. Those keys
 * carry their own TTL and are namespaced per response id, so leaving them
 * behind cannot leak into another test.
 */
export async function clearCache() {
	let cursor = "0";
	do {
		const [nextCursor, keys] = await redisClient.scan(cursor, "COUNT", 1000);
		cursor = nextCursor;
		const deletable = keys.filter(
			(key) => !key.startsWith(RESPONSES_STORAGE_KEY_PREFIX),
		);
		if (deletable.length > 0) {
			await redisClient.unlink(...deletable);
		}
	} while (cursor !== "0");
}

/**
 * Delete every row owned by a single test organization.
 *
 * Test files run in parallel against one database, so a suite that truncates
 * whole tables deletes the API keys, projects and logs another suite is using
 * mid-request. Suites that need a clean slate own a dedicated organization and
 * clean up only that.
 */
export async function cleanupTestOrganization(
	organizationId: string,
	userIds: string[] = [],
) {
	const projects = await db.query.project.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { id: true },
	});
	const projectIds = projects.map((project) => project.id);

	await db
		.delete(tables.log)
		.where(eq(tables.log.organizationId, organizationId));
	if (projectIds.length > 0) {
		await db
			.delete(tables.apiKey)
			.where(inArray(tables.apiKey.projectId, projectIds));
	}
	await db
		.delete(tables.providerKey)
		.where(eq(tables.providerKey.organizationId, organizationId));
	await db
		.delete(tables.userOrganization)
		.where(eq(tables.userOrganization.organizationId, organizationId));
	await db
		.delete(tables.project)
		.where(eq(tables.project.organizationId, organizationId));
	await db
		.delete(tables.organization)
		.where(eq(tables.organization.id, organizationId));
	if (userIds.length > 0) {
		await db.delete(tables.user).where(inArray(tables.user.id, userIds));
	}
}

/**
 * Helper function to wait for logs to be processed by the worker
 * @param expectedCount The expected number of logs
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @param intervalMs Interval between checks in milliseconds
 * @returns Promise that resolves with true if logs are found, false if timed out
 */
export async function waitForLogs(
	expectedCount = 1,
	maxWaitMs = 10000,
	intervalMs = 100,
) {
	const startTime = Date.now();
	console.log(`Waiting for ${expectedCount} logs (timeout: ${maxWaitMs}ms)...`);

	// The deadline is sampled before draining the queue and one final
	// drain+query always runs after it expires: a single processLogQueue call
	// can block for many seconds (its internal insert retry backoff sleeps
	// between attempts), so the deadline may pass while the logs actually
	// landed in the database.
	for (;;) {
		const deadlineReached = Date.now() - startTime >= maxWaitMs;

		try {
			await processLogQueue();
		} catch (error) {
			// A transient Redis/Postgres hiccup on a loaded CI runner shouldn't
			// insta-fail the test; keep polling until the deadline.
			console.warn("processLogQueue failed, retrying:", error);
		}

		const logs = await db.query.log.findMany({});

		if (logs.length >= expectedCount) {
			console.log(
				`Found ${logs.length} logs after ${Date.now() - startTime}ms`,
			);
			return logs;
		}

		if (deadlineReached) {
			break;
		}

		// Wait for the next interval
		await new Promise((resolve) => {
			setTimeout(resolve, intervalMs);
		});
	}

	const message = `Timed out waiting for ${expectedCount} logs after ${Date.now() - startTime}ms`;
	console.warn(message);

	throw new Error(message);
}

/**
 * Helper function to wait for a log entry with a specific request ID
 * @param requestId The request ID to wait for
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @param intervalMs Interval between checks in milliseconds
 * @returns Promise that resolves with the log entry if found
 */
export async function waitForLogByRequestId(
	requestId: string,
	maxWaitMs = 20000,
	intervalMs = 100,
) {
	const startTime = Date.now();

	// Same deadline handling as waitForLogs: always run one final drain+query
	// after the deadline expires, since a single processLogQueue call can block
	// past it while the log actually landed.
	for (;;) {
		const deadlineReached = Date.now() - startTime >= maxWaitMs;

		// Process the log queue to ensure any pending logs are written to the database
		try {
			await processLogQueue();
		} catch (error) {
			// A transient Redis/Postgres hiccup on a loaded CI runner shouldn't
			// insta-fail the test; keep polling until the deadline.
			console.warn("processLogQueue failed, retrying:", error);
		}

		// Query for the specific log entry by request ID
		const logs = await db
			.select()
			.from(tables.log)
			.where(eq(tables.log.requestId, requestId))
			.limit(1);

		const log = logs[0] || null;

		if (log) {
			return log;
		}

		if (deadlineReached) {
			break;
		}

		// Wait for the next interval
		await new Promise((resolve) => {
			setTimeout(resolve, intervalMs);
		});
	}

	const message = `Timed out waiting for log with request ID ${requestId} after ${Date.now() - startTime}ms`;
	console.warn(message);

	throw new Error(message);
}

/**
 * Helper function to read all chunks from a streaming response
 * @param stream The ReadableStream to read from
 * @returns Promise that resolves with parsed stream data including SSE validation
 */
export async function readAll(
	stream: ReadableStream<Uint8Array> | null,
): Promise<{
	fullContent?: string;
	hasContent: boolean;
	eventCount: number;
	hasValidSSE: boolean;
	hasOpenAIFormat: boolean;
	chunks: any[];
	hasUsage: boolean;
	errorEvents: any[];
	hasError: boolean;
}> {
	if (!stream) {
		return {
			hasContent: false,
			eventCount: 0,
			hasValidSSE: false,
			hasOpenAIFormat: false,
			chunks: [],
			hasUsage: false,
			errorEvents: [],
			hasError: false,
		};
	}
	const reader = stream.getReader();
	let fullContent = "";
	let eventCount = 0;
	let hasValidSSE = false;
	let hasContent = false;
	let hasOpenAIFormat = true; // Assume true until proven otherwise
	let hasUsage = false;
	const chunks: any[] = [];
	const errorEvents: any[] = [];
	let hasError = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const chunk = new TextDecoder().decode(value);
			fullContent += chunk;
			const lines = chunk.split("\n");
			let currentEvent = "";
			for (const line of lines) {
				if (line.startsWith("event: ")) {
					currentEvent = line.substring(7).trim();
				} else if (line.startsWith("data: ")) {
					eventCount++;
					hasValidSSE = true;
					if (line === "data: [DONE]") {
						// Reset currentEvent to avoid stale carry-over
						currentEvent = "";
						continue;
					}
					try {
						const data = JSON.parse(line.substring(6));
						// Handle error events
						if (currentEvent === "error" || data.error) {
							errorEvents.push(data);
							hasError = true;
							currentEvent = "";
							continue;
						}
						chunks.push(data);
						// Check if this chunk has OpenAI format
						if (
							!data.id ||
							!data.object ||
							data.object !== "chat.completion.chunk"
						) {
							hasOpenAIFormat = false;
						}
						// Check for content in OpenAI format (should be the primary format after transformation)
						if (
							data.choices?.[0]?.delta?.content ||
							data.choices?.[0]?.finish_reason
						) {
							hasContent = true;
						}
						// Check for usage information
						if (
							data.usage &&
							(data.usage.prompt_tokens !== null ||
								data.usage.completion_tokens !== null ||
								data.usage.total_tokens !== null)
						) {
							hasUsage = true;
						}
					} catch {}
					currentEvent = "";
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
	return {
		fullContent,
		hasContent,
		eventCount,
		hasValidSSE,
		hasOpenAIFormat,
		chunks,
		hasUsage,
		errorEvents,
		hasError,
	};
}
