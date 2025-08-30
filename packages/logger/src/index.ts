import pino, { type Logger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
	name?: string;
	level?: LogLevel;
	prettyPrint?: boolean;
}

class LLMGatewayLogger {
	private logger: Logger;

	constructor(options: LoggerOptions = {}) {
		const {
			name = "llmgateway",
			level = this.getDefaultLevel(),
			prettyPrint = this.shouldPrettyPrint(),
		} = options;

		this.logger = pino({
			name,
			level,
			...(prettyPrint && {
				transport: {
					target: "pino-pretty",
					options: {
						colorize: true,
						translateTime: "HH:MM:ss Z",
						ignore: "pid,hostname",
					},
				},
			}),
		});
	}

	private getDefaultLevel(): LogLevel {
		const nodeEnv = process.env.NODE_ENV;
		if (nodeEnv === "test") {
			return "warn";
		}
		if (nodeEnv === "production") {
			return "info";
		}
		return "debug";
	}

	private shouldPrettyPrint(): boolean {
		const nodeEnv = process.env.NODE_ENV;
		const forcePretty = process.env.LOG_PRETTY === "true";
		const forceJson = process.env.LOG_PRETTY === "false";

		if (forceJson) {
			return false;
		}
		if (forcePretty) {
			return true;
		}

		// Pretty print in development, JSON in production
		return nodeEnv !== "production";
	}

	// Core logging methods
	trace(message: string, extra?: object): void {
		this.logger.trace(extra, message);
	}

	debug(message: string, extra?: object): void {
		this.logger.debug(extra, message);
	}

	info(message: string, extra?: object): void {
		this.logger.info(extra, message);
	}

	warn(message: string, extra?: object): void {
		this.logger.warn(extra, message);
	}

	error(message: string, error?: Error | object): void {
		if (error instanceof Error) {
			this.logger.error({ err: error }, message);
		} else {
			this.logger.error(error, message);
		}
	}

	fatal(message: string, error?: Error | object): void {
		if (error instanceof Error) {
			this.logger.fatal({ err: error }, message);
		} else {
			this.logger.fatal(error, message);
		}
	}

	// Utility methods for specific use cases
	httpRequest(method: string, path: string, extra?: object): void {
		this.debug("HTTP request", { method, path, ...extra });
	}

	httpResponse(
		method: string,
		path: string,
		statusCode: number,
		duration?: number,
		extra?: object,
	): void {
		this.info("HTTP response", {
			method,
			path,
			statusCode,
			duration,
			...extra,
		});
	}

	modelRequest(provider: string, model: string, extra?: object): void {
		this.debug("Model request", { provider, model, ...extra });
	}

	modelResponse(
		provider: string,
		model: string,
		duration?: number,
		extra?: object,
	): void {
		this.info("Model response", { provider, model, duration, ...extra });
	}

	validation(
		message: string,
		provider?: string,
		model?: string,
		extra?: object,
	): void {
		this.debug(message, { provider, model, ...extra });
	}

	// Database operations
	dbQuery(query: string, duration?: number, extra?: object): void {
		this.debug("Database query", {
			query: query.substring(0, 100),
			duration,
			...extra,
		});
	}

	dbError(query: string, error: Error, extra?: object): void {
		this.error("Database error", {
			err: error,
			query: query.substring(0, 100),
			...extra,
		});
	}

	// Cache operations
	cacheHit(key: string, extra?: object): void {
		this.debug("Cache hit", { key, ...extra });
	}

	cacheMiss(key: string, extra?: object): void {
		this.debug("Cache miss", { key, ...extra });
	}

	cacheError(
		operation: string,
		key: string,
		error: Error,
		extra?: object,
	): void {
		this.warn("Cache error", { err: error, operation, key, ...extra });
	}

	// Worker operations
	workerStart(name: string, extra?: object): void {
		this.info("Worker started", { worker: name, ...extra });
	}

	workerStop(name: string, extra?: object): void {
		this.info("Worker stopped", { worker: name, ...extra });
	}

	workerError(name: string, error: Error, extra?: object): void {
		this.error("Worker error", { err: error, worker: name, ...extra });
	}

	// Payment/billing operations
	paymentEvent(event: string, extra?: object): void {
		this.info("Payment event", { event, ...extra });
	}

	paymentError(event: string, error: Error, extra?: object): void {
		this.error("Payment error", { err: error, event, ...extra });
	}

	// Create child logger with additional context
	child(bindings: object): LLMGatewayLogger {
		const childPino = this.logger.child(bindings);
		const childLogger = Object.create(LLMGatewayLogger.prototype);
		childLogger.logger = childPino;
		return childLogger;
	}
}

// Default logger instance
export const logger = new LLMGatewayLogger();

// Factory function for creating named loggers
export function createLogger(options: LoggerOptions): LLMGatewayLogger {
	return new LLMGatewayLogger(options);
}

export { LLMGatewayLogger };
export type { Logger };
