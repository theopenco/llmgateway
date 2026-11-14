export function getAppVersion(): string {
	return process.env.APP_VERSION ?? "v0.0.0-unknown";
}

export interface HealthCheckResult {
	status: "ok" | "error";
	redis: {
		connected: boolean;
		error?: string;
	};
	database: {
		connected: boolean;
		error?: string;
	};
}

export interface HealthCheckOptions {
	timeoutMs?: number;
}

export interface ReadinessGateOptions extends HealthCheckOptions {
	retryMs?: number;
}

type Dependency = "redis" | "database";

interface PendingCall {
	call: Promise<unknown>;
	startedAt: number;
}

// A call still pending after this long is abandoned, so a hung socket cannot
// keep the check failing once the dependency has recovered.
const ABANDON_PENDING_AFTER_MS = 30_000;

export interface HealthCheckDependencies {
	redisClient: {
		ping: () => Promise<string>;
	};
	db: {
		query: {
			user: {
				findFirst: (config?: object) => Promise<unknown>;
			};
		};
	};
	logger: {
		info: (message: string) => void;
		error: (message: string, error?: object | Error | undefined) => void;
	};
}

export interface HealthResponse {
	message: string;
	version: string;
	health: HealthCheckResult;
}

export class HealthChecker {
	private ready = true;
	private pending: Partial<Record<Dependency, PendingCall>> = {};

	public constructor(
		private dependencies: HealthCheckDependencies,
		private defaults: HealthCheckOptions = {},
	) {}

	/** False only between `gateReadiness` and its first passing check. */
	public isReady(): boolean {
		return this.ready;
	}

	/**
	 * Closes readiness until Postgres and Redis answer once, then leaves it open
	 * for the life of the process: a release that cannot reach them never goes
	 * Ready, and a later outage never pulls a running pod. Returns a function
	 * that stops the retries.
	 */
	public gateReadiness(options: ReadinessGateOptions = {}): () => void {
		const { retryMs = 5000, ...checkOptions } = options;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		this.ready = false;
		const attempt = async () => {
			const { status } = await this.performHealthChecks(checkOptions);
			if (stopped) {
				return;
			}
			if (status === "ok") {
				this.ready = true;
				this.dependencies.logger.info("Startup dependency check passed");
				return;
			}
			timer = setTimeout(() => void attempt(), retryMs);
		};
		void attempt();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}

	/**
	 * One call per dependency at a time. A call that outlives its timeout stays
	 * shared until it settles, so a stalled dependency cannot stack more.
	 */
	private shared(
		dependency: Dependency,
		start: () => Promise<unknown>,
	): Promise<unknown> {
		const current = this.pending[dependency];
		if (current && Date.now() - current.startedAt < ABANDON_PENDING_AFTER_MS) {
			return current.call;
		}
		const entry: PendingCall = {
			startedAt: Date.now(),
			call: new Promise((resolve) => resolve(start())).finally(() => {
				if (this.pending[dependency] === entry) {
					this.pending[dependency] = undefined;
				}
			}),
		};
		this.pending[dependency] = entry;
		return entry.call;
	}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<T>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		});
		return Promise.race([promise, timeoutPromise]).finally(() =>
			clearTimeout(timer),
		);
	}

	public async performHealthChecks(
		options: HealthCheckOptions = {},
	): Promise<HealthCheckResult> {
		const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs ?? 3000;
		const { redisClient, db, logger } = this.dependencies;

		const health: HealthCheckResult = {
			status: "ok",
			redis: { connected: false, error: undefined },
			database: { connected: false, error: undefined },
		};

		const [redis, database] = await Promise.allSettled([
			this.withTimeout(
				this.shared("redis", () => redisClient.ping()),
				timeoutMs,
			),
			// One column, so the check tests connectivity, not the row shape the
			// running release expects.
			this.withTimeout(
				this.shared("database", () =>
					db.query.user.findFirst({ columns: { id: true } }),
				),
				timeoutMs,
			),
		]);

		if (redis.status === "fulfilled") {
			health.redis.connected = true;
		} else {
			health.status = "error";
			health.redis.error = isTimeout(redis.reason)
				? "Redis check timed out"
				: "Redis connection failed";
			logger.error("Redis healthcheck failed", redis.reason);
		}

		if (database.status === "fulfilled") {
			health.database.connected = true;
		} else {
			health.status = "error";
			health.database.error = isTimeout(database.reason)
				? "Database check timed out"
				: "Database connection failed";
			logger.error("Database healthcheck failed", database.reason);
		}

		return health;
	}

	public createHealthResponse(
		health: HealthCheckResult,
		version?: string,
	): { response: HealthResponse; statusCode: number } {
		const statusCode = health.status === "error" ? 503 : 200;

		// Set appropriate message based on health status
		let message = "OK";
		if (health.status === "error") {
			const failedSystems: string[] = [];
			if (health.redis.error) {
				failedSystems.push("Redis");
			}
			if (health.database.error) {
				failedSystems.push("Database");
			}

			if (failedSystems.length > 0) {
				message = `Service Unavailable - ${failedSystems.join(", ")} ${failedSystems.length === 1 ? "is" : "are"} unavailable`;
			} else {
				message = "Service Unavailable";
			}
		}

		return {
			response: {
				message,
				version: version ?? getAppVersion(),
				health,
			},
			statusCode,
		};
	}
}
function isTimeout(reason: unknown): boolean {
	const message = reason instanceof Error ? reason.message : String(reason);
	return message.includes("timed out");
}
