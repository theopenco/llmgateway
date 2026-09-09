export function getRateLimitHeaders({
	policy = "requests",
	limit,
	remaining,
	reset,
	window,
}: {
	policy?: "requests" | "concurrency";
	limit: number;
	remaining: number;
	reset: number;
	window?: number;
}): Record<string, string> {
	return {
		"RateLimit-Policy": `"${policy}";q=${limit}${policy === "concurrency" ? ';qu="concurrent-requests"' : ""}${window === undefined ? "" : `;w=${window}`}`,
		RateLimit: `"${policy}";r=${remaining};t=${reset}`,
		"RateLimit-Limit": String(limit),
		"RateLimit-Remaining": String(remaining),
		"RateLimit-Reset": String(reset),
		"X-RateLimit-Limit": String(limit),
		"X-RateLimit-Remaining": String(remaining),
		"X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + reset),
	};
}
