import { HTTPException } from "hono/http-exception";

import { db, tables } from "@llmgateway/db";
import { getProviderDefinition, providers } from "@llmgateway/models";
import {
	CONTENT_FILTER_SETTING_ID,
	contentFilterSettingsSchema,
	parseContentFilterSettings,
	type ContentFilterSettings,
} from "@llmgateway/shared";

export async function getContentFilterSettings(): Promise<ContentFilterSettings> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: CONTENT_FILTER_SETTING_ID },
	});
	return parseContentFilterSettings(setting?.value);
}

export async function setContentFilterSettings(
	input: ContentFilterSettings,
): Promise<ContentFilterSettings> {
	const unknown = [...input.providerIds, ...input.enforceProviderIds].filter(
		(providerId) => !getProviderDefinition(providerId),
	);
	if (unknown.length > 0) {
		throw new HTTPException(400, {
			message: `Unknown provider id(s): ${unknown.join(", ")}`,
		});
	}
	const settings = contentFilterSettingsSchema.parse({
		...input,
		providerIds: [...new Set(input.providerIds)],
		enforceProviderIds: [...new Set(input.enforceProviderIds)],
	});
	const value = JSON.stringify(settings);
	await db
		.insert(tables.systemSetting)
		.values({
			id: CONTENT_FILTER_SETTING_ID,
			enabled: settings.enabled,
			value,
		})
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: { enabled: settings.enabled, value, updatedAt: new Date() },
		});
	return settings;
}

/** Every catalogue provider with its enabled and enforced flags, for the admin page. */
export function listContentFilterProviders(settings: ContentFilterSettings) {
	const enabled = new Set(settings.providerIds);
	const enforced = new Set(settings.enforceProviderIds);
	return providers
		.map((provider) => ({
			id: provider.id,
			name: provider.name,
			color: provider.color ?? null,
			enabled: enabled.has(provider.id),
			enforced: enforced.has(provider.id),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
