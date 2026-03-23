export const VIDEO_PROXY_REDIS_TTL_SECONDS = 60 * 60 * 24 * 7;

export function getVideoProxyRedisKey(logId: string): string {
	return `video:proxy:source:${logId}`;
}
