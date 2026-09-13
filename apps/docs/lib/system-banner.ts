import type { SystemBanner } from "@llmgateway/shared";

const apiBackendUrl =
	process.env.API_BACKEND_URL ?? process.env.API_URL ?? "http://localhost:4002";

/**
 * Admin-toggled announcement banner. Plain fetch because the docs app has no
 * generated API client; revalidated often enough that switching the banner off
 * takes effect within seconds, without a backend read per page view.
 */
export async function fetchSystemBanner(): Promise<SystemBanner | null> {
	try {
		const response = await fetch(`${apiBackendUrl}/public/banner`, {
			next: { revalidate: 30 },
		});
		if (!response.ok) {
			return null;
		}
		const body = (await response.json()) as { banner: SystemBanner | null };
		return body.banner;
	} catch (error) {
		// Every page renders this: a backend outage must not blank the docs,
		// which is exactly when an incident banner would be configured.
		// eslint-disable-next-line no-console -- the docs app has no logger
		console.error("Failed to load the announcement banner:", error);
		return null;
	}
}
