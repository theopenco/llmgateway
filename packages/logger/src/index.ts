import { isSpanContextValid, trace, TraceFlags } from "@opentelemetry/api";
import pino, { type Logger } from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface TraceContext {
	traceId?: string;
	spanId?: string;
	traceFlags?: string;
}

export interface LoggerOptions {
	name?: string;
	level?: LogLevel;
	prettyPrint?: boolean;
}

// Google Cloud Logging severity mapping
const PinoLevelToSeverityLookup: Record<string, string> = {
	trace: "DEBUG",
	debug: "DEBUG",
	info: "INFO",
	warn: "WARNING",
	error: "ERROR",
	fatal: "CRITICAL",
};

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
			// Always ignore pid and hostname
			base: undefined,
			// Add Google Cloud Logging compatibility
			...(!prettyPrint && {
				formatters: {
					level(label: string, number: number) {
						return {
							severity:
								PinoLevelToSeverityLookup[label] ||
								PinoLevelToSeverityLookup.info,
							level: number,
						};
					},
				},
			}),
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

	private getTraceContext(): object {
		const span = trace.getActiveSpan();
		if (!span) {
			return {};
		}

		const spanContext = span.spanContext();
		if (!spanContext || !isSpanContextValid(spanContext)) {
			return {};
		}

		const projectId = process.env.GOOGLE_CLOUD_PROJECT;
		const traceId = spanContext.traceId;

		return {
			// Google Cloud Logging trace correlation
			"logging.googleapis.com/trace": projectId
				? `projects/${projectId}/traces/${traceId}`
				: traceId,
			"logging.googleapis.com/spanId": spanContext.spanId,
			"logging.googleapis.com/trace_sampled": Boolean(
				spanContext.traceFlags & TraceFlags.SAMPLED,
			),
			// Additional context for manual correlation
			traceId,
			spanId: spanContext.spanId,
			traceFlags: spanContext.traceFlags.toString(),
		};
	}

	// Core logging methods
	public trace(message: string, extra?: object): void {
		const traceContext = this.getTraceContext();
		this.logger.trace({ ...traceContext, ...extra }, message);
	}

	public debug(message: string, extra?: object): void {
		const traceContext = this.getTraceContext();
		this.logger.debug({ ...traceContext, ...extra }, message);
	}

	public info(message: string, extra?: object): void {
		const traceContext = this.getTraceContext();
		this.logger.info({ ...traceContext, ...extra }, message);
	}

	public warn(message: string, extra?: object): void {
		const traceContext = this.getTraceContext();
		this.logger.warn({ ...traceContext, ...extra }, message);
	}

	public error(message: string, error?: Error | object): void {
		const traceContext = this.getTraceContext();
		if (error instanceof Error) {
			this.logger.error({ ...traceContext, err: error }, message);
		} else {
			this.logger.error({ ...traceContext, ...error }, message);
		}
	}

	public fatal(message: string, error?: Error | object): void {
		const traceContext = this.getTraceContext();
		if (error instanceof Error) {
			this.logger.fatal({ ...traceContext, err: error }, message);
		} else {
			this.logger.fatal({ ...traceContext, ...error }, message);
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
