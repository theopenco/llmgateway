import pino, { type Logger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
	name?: string;
	level?: LogLevel;
	prettyPrint?: boolean;
}

class LLMGatewayLogger {
	private logger: Logger;

	public constructor(options: LoggerOptions = {}) {
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
	public trace(message: string, extra?: object): void {
		this.logger.trace(extra, message);
	}

	public debug(message: string, extra?: object): void {
		this.logger.debug(extra, message);
	}

	public info(message: string, extra?: object): void {
		this.logger.info(extra, message);
	}

	public warn(message: string, extra?: object): void {
		this.logger.warn(extra, message);
	}

	public error(message: string, error?: Error | object): void {
		if (error instanceof Error) {
			this.logger.error({ err: error }, message);
		} else {
			this.logger.error(error, message);
		}
	}

	public fatal(message: string, error?: Error | object): void {
		if (error instanceof Error) {
			this.logger.fatal({ err: error }, message);
		} else {
			this.logger.fatal(error, message);
		}
	}

	// Create child logger with additional context
	public child(bindings: object): LLMGatewayLogger {
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
