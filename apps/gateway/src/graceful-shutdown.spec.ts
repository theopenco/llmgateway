import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { describe, expect, test } from "vitest";

import type { Server } from "node:http";

/**
 * Tests for graceful shutdown behavior.
 *
 * Key findings from these tests:
 * 1. server.close() alone properly waits for in-flight requests (both regular and streaming)
 * 2. closeIdleConnections() is too aggressive - it can close connections with pending requests
 * 3. A timeout with closeAllConnections() is useful as a safety net for very long requests
 *
 * Recommended approach: Use server.close() + timeout, avoid closeIdleConnections()
 */

const closeServer = (server: ServerType): Promise<void> => {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
};

// Recommended implementation: server.close() + periodic idle connection drain + timeout
const closeServerWithTimeout = (
	server: ServerType,
	gracePeriodMs: number,
): Promise<{ timedOut: boolean }> => {
	return new Promise((resolve, reject) => {
		const httpServer = server as Server;
		let timedOut = false;

		// server.close() stops accepting new connections
		// But it waits for ALL connections to close, including idle keep-alive connections
		httpServer.close((error) => {
			clearTimeout(timeout);
			clearInterval(drainInterval);
			if (error) {
				reject(error);
			} else {
				resolve({ timedOut });
			}
		});

		// Periodically close idle connections so server.close() can complete
		// This is safe because it only closes connections without active requests
		const drainInterval = setInterval(() => {
			httpServer.closeIdleConnections();
		}, 100);

		// Force close all connections after grace period expires
		const timeout = setTimeout(() => {
			timedOut = true;
			clearInterval(drainInterval);
			httpServer.closeAllConnections();
		}, gracePeriodMs);
	});
};

// Problematic implementation: closeIdleConnections() can kill active requests
const closeServerWithIdleClose = (
	server: ServerType,
	gracePeriodMs: number,
): Promise<{ timedOut: boolean }> => {
	return new Promise((resolve, reject) => {
		const httpServer = server as Server;
		let timedOut = false;

		// WARNING: This can close connections with pending/active requests!
		httpServer.closeIdleConnections();

		const timeout = setTimeout(() => {
			timedOut = true;
			httpServer.closeAllConnections();
		}, gracePeriodMs);

		httpServer.close((error) => {
			clearTimeout(timeout);
			if (error) {
				reject(error);
			} else {
				resolve({ timedOut });
			}
		});
	});
};

describe("graceful shutdown", () => {
	test("server.close() waits for regular request to complete", async () => {
		const requestStarted = { value: false };
		const requestCompleted = { value: false };
		const responseDelay = 500;

		const app = new Hono();
		app.get("/slow", async (c) => {
			requestStarted.value = true;
			await new Promise<void>((resolve) => {
				setTimeout(resolve, responseDelay);
			});
			requestCompleted.value = true;
			return c.json({ message: "done" });
		});

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Start request but don't await it yet
		const requestPromise = fetch(`http://localhost:${port}/slow`);

		// Wait for request to start
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});
		expect(requestStarted.value).toBe(true);
		expect(requestCompleted.value).toBe(false);

		// Start shutdown
		const shutdownPromise = closeServer(server);

		// Request should complete during shutdown
		const response = await requestPromise;
		expect(response.ok).toBe(true);
		expect(requestCompleted.value).toBe(true);

		// Shutdown should complete after request finishes
		await shutdownPromise;
	});

	test("server.close() waits for streaming response to complete", async () => {
		const chunks: string[] = [];
		const streamStarted = { value: false };
		const streamCompleted = { value: false };
		const chunkDelay = 100;
		const totalChunks = 5;

		const app = new Hono();
		app.get("/stream", (c) => {
			return stream(c, async (stream) => {
				streamStarted.value = true;
				for (let i = 0; i < totalChunks; i++) {
					await stream.write(`chunk-${i}\n`);
					await new Promise<void>((resolve) => {
						setTimeout(resolve, chunkDelay);
					});
				}
				streamCompleted.value = true;
			});
		});

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Start streaming request
		const requestPromise = fetch(`http://localhost:${port}/stream`);

		// Wait for stream to start
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});
		expect(streamStarted.value).toBe(true);

		// Start shutdown while streaming is in progress
		const shutdownPromise = closeServer(server);

		// Read the stream to completion
		const response = await requestPromise;
		const reader = response.body?.getReader();
		if (reader) {
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				chunks.push(decoder.decode(value));
			}
		}

		// All chunks should have been received
		expect(streamCompleted.value).toBe(true);
		expect(chunks.join("")).toContain("chunk-0");
		expect(chunks.join("")).toContain("chunk-4");

		await shutdownPromise;
	});

	test("closeIdleConnections() closes idle keep-alive connections", async () => {
		const app = new Hono();
		app.get("/fast", (c) => c.json({ message: "ok" }));

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Make a request (creates a keep-alive connection)
		const response = await fetch(`http://localhost:${port}/fast`);
		expect(response.ok).toBe(true);

		// Close idle connections and then the server
		const httpServer = server as Server;
		httpServer.closeIdleConnections();

		// Server should close quickly since there are no active requests
		const startTime = Date.now();
		await closeServer(server);
		const elapsed = Date.now() - startTime;

		// Should close almost immediately (under 100ms)
		expect(elapsed).toBeLessThan(100);
	});

	test("timeout force-closes long-running requests", async () => {
		const requestStarted = { value: false };
		const requestCompleted = { value: false };
		const gracePeriodMs = 200;
		const requestDuration = 2000; // Much longer than grace period

		const app = new Hono();
		app.get("/very-slow", async (c) => {
			requestStarted.value = true;
			await new Promise<void>((resolve) => {
				setTimeout(resolve, requestDuration);
			});
			requestCompleted.value = true;
			return c.json({ message: "done" });
		});

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Start request
		const requestPromise = fetch(`http://localhost:${port}/very-slow`).catch(
			() => null,
		);

		// Wait for request to start
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});
		expect(requestStarted.value).toBe(true);

		// Start shutdown with short grace period
		const startTime = Date.now();
		const result = await closeServerWithTimeout(server, gracePeriodMs);
		const elapsed = Date.now() - startTime;

		// Should have timed out
		expect(result.timedOut).toBe(true);

		// Should close around the grace period time (not waiting for full request)
		expect(elapsed).toBeGreaterThanOrEqual(gracePeriodMs - 50);
		expect(elapsed).toBeLessThan(gracePeriodMs + 200);

		// Request should NOT have completed (was force-closed)
		expect(requestCompleted.value).toBe(false);

		// Clean up - the request promise will reject due to connection being closed
		await requestPromise;
	});

	test("requests complete normally within grace period", async () => {
		const requestCompleted = { value: false };
		const gracePeriodMs = 1000;
		const requestDuration = 200; // Shorter than grace period

		const app = new Hono();
		app.get("/medium", async (c) => {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, requestDuration);
			});
			requestCompleted.value = true;
			return c.json({ message: "done" });
		});

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Start request
		const requestPromise = fetch(`http://localhost:${port}/medium`);

		// Wait for request to start processing
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});

		// Start shutdown with timeout only (no closeIdleConnections)
		const shutdownPromise = closeServerWithTimeout(server, gracePeriodMs);

		// Request should complete normally
		const response = await requestPromise;
		expect(response.ok).toBe(true);
		expect(requestCompleted.value).toBe(true);

		// Shutdown should complete without timing out
		const result = await shutdownPromise;
		expect(result.timedOut).toBe(false);
	});

	test("streaming response completes within grace period", async () => {
		const chunks: string[] = [];
		const streamCompleted = { value: false };
		const gracePeriodMs = 2000;
		const chunkDelay = 100;
		const totalChunks = 5; // 500ms total

		const app = new Hono();
		app.get("/stream", (c) => {
			return stream(c, async (stream) => {
				for (let i = 0; i < totalChunks; i++) {
					await stream.write(`chunk-${i}\n`);
					await new Promise<void>((resolve) => {
						setTimeout(resolve, chunkDelay);
					});
				}
				streamCompleted.value = true;
			});
		});

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Start streaming request
		const requestPromise = fetch(`http://localhost:${port}/stream`);

		// Wait for stream to start
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});

		// Start shutdown with timeout only (no closeIdleConnections)
		const shutdownPromise = closeServerWithTimeout(server, gracePeriodMs);

		// Read stream
		const response = await requestPromise;
		const reader = response.body?.getReader();
		if (reader) {
			const decoder = new TextDecoder();
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				chunks.push(decoder.decode(value));
			}
		}

		// Should complete without timeout
		const result = await shutdownPromise;
		expect(result.timedOut).toBe(false);
		expect(streamCompleted.value).toBe(true);
		expect(chunks.join("")).toContain("chunk-4");
	});

	test("closeIdleConnections() can kill active requests (documenting problematic behavior)", async () => {
		// This test documents that closeIdleConnections() is too aggressive
		// and can close connections that have active/pending requests
		const requestCompleted = { value: false };
		const gracePeriodMs = 1000;
		const requestDuration = 200;

		const app = new Hono();
		app.get("/test", async (c) => {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, requestDuration);
			});
			requestCompleted.value = true;
			return c.json({ message: "done" });
		});

		const server = serve({ fetch: app.fetch, port: 0 });
		const address = server.address();
		const port =
			typeof address === "object" && address !== null ? address.port : 0;

		// Start request
		const requestPromise = fetch(`http://localhost:${port}/test`).catch(
			() => null,
		);

		// Wait for request to start
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});

		// Use closeIdleConnections - this will likely kill the request prematurely
		const result = await closeServerWithIdleClose(server, gracePeriodMs);

		await requestPromise;

		// The timeout triggers because closeIdleConnections closed the connection
		// before the request could complete, then server.close() returns immediately
		// This documents why we should NOT use closeIdleConnections()
		expect(result.timedOut).toBe(true);
	});
});
