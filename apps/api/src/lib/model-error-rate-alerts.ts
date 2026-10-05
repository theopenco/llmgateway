import { HTTPException } from "hono/http-exception";

import { db, tables } from "@llmgateway/db";
import {
	MODEL_ERROR_RATE_ALERTS_SETTING_ID,
	modelErrorRateAlertsSettingsSchema,
	parseModelErrorRateAlertsSettings,
	type ModelErrorRateAlertsSettings,
} from "@llmgateway/shared";

export async function getModelErrorRateAlertsSettings(): Promise<ModelErrorRateAlertsSettings> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: MODEL_ERROR_RATE_ALERTS_SETTING_ID },
	});
	return parseModelErrorRateAlertsSettings(setting?.value);
}

export async function setModelErrorRateAlertsSettings(
	input: ModelErrorRateAlertsSettings,
): Promise<ModelErrorRateAlertsSettings> {
	const ids = input.rules.map((rule) => rule.id);
	if (new Set(ids).size !== ids.length) {
		throw new HTTPException(400, {
			message: "Each alert rule needs a unique id.",
		});
	}
	const settings = modelErrorRateAlertsSettingsSchema.parse(input);
	const value = JSON.stringify(settings);
	await db
		.insert(tables.systemSetting)
		.values({
			id: MODEL_ERROR_RATE_ALERTS_SETTING_ID,
			enabled: settings.enabled,
			value,
		})
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: { enabled: settings.enabled, value, updatedAt: new Date() },
		});
	return settings;
}
