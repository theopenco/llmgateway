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
	skipChecks?: string[];
	timeoutMs?: number;
}

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
		error: (message: string, error?: object | Error | undefined) => void;
	};
}

export interface HealthResponse {
	message: string;
	version: string;
	health: HealthCheckResult;
}

export class HealthChecker {
	public constructor(private dependencies: HealthCheckDependencies) {}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		const timeoutPromise = new Promise<T>((_, reject) => {
			setTimeout(
				() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		});
		return Promise.race([promise, timeoutPromise]);
	}

	public async performHealthChecks(
		options: HealthCheckOptions = {},
	): Promise<HealthCheckResult> {
		const { skipChecks = [], timeoutMs = 3000 } = options;
		const { redisClient, db, logger } = this.dependencies;

		const health: HealthCheckResult = {
			status: "ok",
			redis: { connected: false, error: undefined },
			database: { connected: false, error: undefined },
		};

		// Run health checks in parallel
		const healthChecks = await Promise.allSettled([
			// Redis check
			skipChecks.includes("redis")
				? Promise.resolve({ type: "redis" as const, skipped: true })
				: this.withTimeout(
						redisClient
							.ping()
							.then(() => ({ type: "redis" as const, success: true })),
						timeoutMs,
					),
			// Database check
			skipChecks.includes("database")
				? Promise.resolve({ type: "database" as const, skipped: true })
				: this.withTimeout(
						db.query.user
							.findFirst({})
							.then(() => ({ type: "database" as const, success: true })),
						timeoutMs,
					),
		]);

		// Process results
		for (const result of healthChecks) {
			if (result.status === "fulfilled") {
				const check = result.value;
				if ("skipped" in check && check.skipped) {
					// Set as connected when skipped
					if (check.type === "redis") {
						health.redis.connected = true;
					}
					if (check.type === "database") {
						health.database.connected = true;
					}
				} else if ("success" in check && check.success) {
					// Set as connected when successful
					if (check.type === "redis") {
						health.redis.connected = true;
					}
					if (check.type === "database") {
						health.database.connected = true;
					}
				}
			} else {
				// Handle failures
				const errorMessage =
					result.reason instanceof Error
						? result.reason.message
						: String(result.reason);

				// Determine which check failed based on the error or order
				// Since we know the order: [redis, database]
				const checkIndex = healthChecks.indexOf(result);
				if (checkIndex === 0) {
					// Redis check failed
					health.status = "error";
					health.redis.error = errorMessage.includes("timed out")
						? "Redis check timed out"
						: "Redis connection failed";
					logger.error("Redis healthcheck failed", result.reason);
				} else if (checkIndex === 1) {
					// Database check failed
					health.status = "error";
					health.database.error = errorMessage.includes("timed out")
						? "Database check timed out"
						: "Database connection failed";
					logger.error("Database healthcheck failed", result.reason);
				}
			}
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
				version: version ?? process.env.APP_VERSION ?? "v0.0.0-unknown",
				health,
			},
			statusCode,
		};
	}
}
