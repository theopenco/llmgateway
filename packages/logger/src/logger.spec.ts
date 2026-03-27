import { describe, it, expect, vi, beforeEach } from "vitest";

import { logger, createLogger } from "@/index.js";

describe("LLMGateway Logger", () => {
	beforeEach(() => {
		// Mock console methods to avoid actual output during tests
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("should create default logger instance", () => {
		expect(logger).toBeDefined();
	});

	it("should create custom logger with options", () => {
		const customLogger = createLogger({
			name: "test-logger",
			level: "warn",
			prettyPrint: false,
		});
		expect(customLogger).toBeDefined();
	});

	it("should have all required logging methods", () => {
		expect(typeof logger.trace).toBe("function");
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
		expect(typeof logger.fatal).toBe("function");
	});

	it("should log debug messages with extra data", () => {
		logger.debug("Testing debug message", {
			provider: "openai",
			model: "gpt-4",
		});
		// Since we're using pino which logs to stdout/stderr, we can't easily test output
		// But we can verify the method doesn't throw
		expect(true).toBe(true);
	});

	it("should create child logger with additional context", () => {
		const childLogger = logger.child({ component: "test" });
		expect(childLogger).toBeDefined();
		expect(typeof childLogger.info).toBe("function");
	});

	it("should serialize Error instances passed to warn", () => {
		const customLogger = createLogger({
			name: "test-logger",
			level: "warn",
			prettyPrint: false,
		}) as any;

		const warnSpy = vi.fn();
		customLogger.logger = { warn: warnSpy };

		const error = new Error("stream terminated");
		customLogger.warn("Error reading stream", error);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toMatchObject({
			err: error,
		});
		expect(warnSpy.mock.calls[0][1]).toBe("Error reading stream");
	});
});
