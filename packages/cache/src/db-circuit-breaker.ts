import { logger } from "@llmgateway/logger";

/**
 * Thrown instead of running a database fetch while the circuit is open, so a
 * cache miss fails in milliseconds rather than waiting out the pool's
 * connection timeout behind an unavailable or lock-saturated database.
 */
export class DbCircuitOpenError extends Error {
	public constructor() {
		super("Database temporarily unavailable (circuit open)");
		this.name = "DbCircuitOpenError";
	}
}

// SQLSTATEs meaning the database (not the query) is the problem.
const UNAVAILABLE_SQLSTATES = new Set([
	"53300", // too_many_connections
	"53400", // configuration_limit_exceeded
	"55P03", // lock_not_available (lock_timeout)
	"57014", // query_canceled (statement_timeout)
	"57P01", // admin_shutdown
	"57P02", // crash_shutdown
	"57P03", // cannot_connect_now
]);

const UNAVAILABLE_MESSAGES = [
	"timeout exceeded when trying to connect",
	"connection terminated",
	"connection timeout",
	"econnrefused",
	"econnreset",
	"etimedout",
	"remaining connection slots are reserved",
];

/**
 * Whether an error (or any error in its `cause` chain, as Drizzle wraps driver
 * errors) means Postgres is unreachable or saturated. Query bugs and
 * constraint violations do not count.
 */
export function isDbUnavailableError(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current; depth++) {
		if (typeof current !== "object") {
			return false;
		}
		const { code, message, cause } = current as {
			code?: unknown;
			message?: unknown;
			cause?: unknown;
		};
		if (
			typeof code === "string" &&
			(UNAVAILABLE_SQLSTATES.has(code) || code.startsWith("08"))
		) {
			return true;
		}
		if (typeof message === "string") {
			const lower = message.toLowerCase();
			if (UNAVAILABLE_MESSAGES.some((needle) => lower.includes(needle))) {
				return true;
			}
		}
		current = cause;
	}
	return false;
}

function envPositiveInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

type CircuitState = "closed" | "open" | "half-open";

let state: CircuitState = "closed";
let consecutiveFailures = 0;
let openedAt = 0;

/** Current breaker state, for logs and tests. */
export function getDbCircuitState(): CircuitState {
	if (state === "open" && Date.now() - openedAt >= openDurationMs()) {
		return "half-open";
	}
	return state;
}

function openDurationMs(): number {
	return envPositiveInt("DB_CIRCUIT_OPEN_MS", 5000);
}

/**
 * Whether a database fetch may run now. While open, only one probe per open
 * interval is let through; its outcome closes or re-opens the circuit.
 */
export function dbCircuitAllowsRequest(): boolean {
	if (state === "closed") {
		return true;
	}
	if (state === "open" && Date.now() - openedAt >= openDurationMs()) {
		state = "half-open";
		return true;
	}
	return false;
}

export function recordDbSuccess(): void {
	consecutiveFailures = 0;
	if (state !== "closed") {
		state = "closed";
		logger.info("Database circuit closed");
	}
}

export function recordDbFailure(error: unknown): void {
	if (!isDbUnavailableError(error)) {
		return;
	}
	consecutiveFailures++;
	const threshold = envPositiveInt("DB_CIRCUIT_FAILURE_THRESHOLD", 5);
	if (state === "half-open" || consecutiveFailures >= threshold) {
		if (state !== "open") {
			logger.warn("Database circuit opened; serving cached data only", {
				consecutiveFailures,
				openMs: openDurationMs(),
				error: error instanceof Error ? error.message : String(error),
			});
		}
		state = "open";
		openedAt = Date.now();
	}
}

/** Test helper: reset to closed. */
export function resetDbCircuit(): void {
	state = "closed";
	consecutiveFailures = 0;
	openedAt = 0;
}
