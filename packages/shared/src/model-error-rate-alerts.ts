import { z } from "zod";

/** `system_setting` row holding the model error-rate Discord alert rules. */
export const MODEL_ERROR_RATE_ALERTS_SETTING_ID = "model_error_rate_alerts";

export const MODEL_ERROR_RATE_ALERTS_MAX_RULES = 10;

export const modelErrorRateAlertRuleSchema = z.object({
	// Stable key for the per-mapping cooldown; editing a rule keeps its id.
	id: z
		.string()
		.regex(
			/^[a-z0-9-]{1,32}$/,
			"Rule ids are 1-32 lowercase letters, digits or dashes",
		),
	label: z.string().trim().min(1).max(64),
	enabled: z.boolean(),
	windowMinutes: z.number().int().min(1).max(1440),
	// Gateway + upstream errors over requests that were not client errors.
	errorRatePercent: z.number().min(1).max(100),
	// Non-client-error requests a mapping needs in the window to be judged.
	minRequests: z.number().int().min(1).max(1_000_000),
	// Minimum time between two alerts for the same rule and mapping.
	cooldownMinutes: z.number().int().min(1).max(10_080),
	// When false, attempts the gateway retried elsewhere count neither as
	// requests nor as errors.
	includeRetriedErrors: z.boolean().default(true),
});

export type ModelErrorRateAlertRule = z.infer<
	typeof modelErrorRateAlertRuleSchema
>;

export const DEFAULT_MODEL_ERROR_RATE_ALERT_RULES: ModelErrorRateAlertRule[] = [
	{
		id: "short",
		label: "15m warning",
		enabled: true,
		windowMinutes: 15,
		errorRatePercent: 30,
		minRequests: 20,
		cooldownMinutes: 60,
		includeRetriedErrors: true,
	},
	{
		id: "long",
		label: "4h warning",
		enabled: true,
		windowMinutes: 240,
		errorRatePercent: 30,
		minRequests: 100,
		cooldownMinutes: 240,
		includeRetriedErrors: true,
	},
];

export const modelErrorRateAlertsSettingsSchema = z.object({
	// Master switch; nothing is evaluated or sent while off.
	enabled: z.boolean().default(false),
	rules: z
		.array(modelErrorRateAlertRuleSchema)
		.max(MODEL_ERROR_RATE_ALERTS_MAX_RULES)
		.default(DEFAULT_MODEL_ERROR_RATE_ALERT_RULES),
});

export type ModelErrorRateAlertsSettings = z.infer<
	typeof modelErrorRateAlertsSettingsSchema
>;

export const DEFAULT_MODEL_ERROR_RATE_ALERTS_SETTINGS: ModelErrorRateAlertsSettings =
	modelErrorRateAlertsSettingsSchema.parse({});

/** Parse the stored JSON value; missing or invalid input yields the defaults. */
export function parseModelErrorRateAlertsSettings(
	value: string | null | undefined,
): ModelErrorRateAlertsSettings {
	if (!value) {
		return DEFAULT_MODEL_ERROR_RATE_ALERTS_SETTINGS;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return DEFAULT_MODEL_ERROR_RATE_ALERTS_SETTINGS;
	}
	const result = modelErrorRateAlertsSettingsSchema.safeParse(parsed);
	return result.success
		? result.data
		: DEFAULT_MODEL_ERROR_RATE_ALERTS_SETTINGS;
}
