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
		const { timeoutMs = 3000 } = options;
		const { redisClient, db, logger } = this.dependencies;

		const health: HealthCheckResult = {
			status: "ok",
			redis: { connected: false, error: undefined },
			database: { connected: false, error: undefined },
		};

		const [redis, database] = await Promise.allSettled([
			this.withTimeout(redisClient.ping(), timeoutMs),
			// One column, so the check tests connectivity, not the row shape the
			// running release expects.
			this.withTimeout(
				db.query.user.findFirst({ columns: { id: true } }),
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
