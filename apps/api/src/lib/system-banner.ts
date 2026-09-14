import { db, tables } from "@llmgateway/db";
import {
	normalizeSystemBanner,
	parseSystemBanner,
	serializeSystemBanner,
} from "@llmgateway/shared";

import type { SystemBanner } from "@llmgateway/shared";

/** Admin-configurable announcement banner, edited in the admin dashboard. */
export const SYSTEM_BANNER_SETTING_ID = "system_banner";

export interface SystemBannerSetting {
	enabled: boolean;
	banner: SystemBanner | null;
}

/** The stored draft, whether or not it is currently published. */
export async function getSystemBannerSetting(): Promise<SystemBannerSetting> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: SYSTEM_BANNER_SETTING_ID },
	});
	return {
		enabled: setting?.enabled ?? false,
		banner: parseSystemBanner(setting?.value),
	};
}

/** What the public sites render — null unless the banner is switched on. */
export async function getActiveSystemBanner(): Promise<SystemBanner | null> {
	const { enabled, banner } = await getSystemBannerSetting();
	return enabled ? banner : null;
}

export async function setSystemBannerSetting(input: {
	enabled: boolean;
	message: string;
	severity: string;
	linkUrl: string | null;
	linkLabel: string | null;
}): Promise<SystemBannerSetting> {
	const banner = normalizeSystemBanner(input);
	// An empty message cannot be published, so the toggle follows the content.
	const enabled = input.enabled && banner !== null;
	const value = banner ? serializeSystemBanner(banner) : null;

	await db
		.insert(tables.systemSetting)
		.values({ id: SYSTEM_BANNER_SETTING_ID, enabled, value })
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: { enabled, value, updatedAt: new Date() },
		});

	return { enabled, banner };
}
