import { z } from "zod";

/**
 * Organization-level alerts for bring-your-own-key provider keys whose error
 * rate climbs over a threshold, stored in `organization.providerKeyAlertSettings`.
 */
export const PROVIDER_KEY_ALERTS_MAX_RULES = 5;

export const providerKeyAlertRuleSchema = z.object({
	// Stable key for the per-key cooldown; editing a rule keeps its id.
	id: z
		.string()
		.regex(
			/^[a-z0-9-]{1,32}$/,
			"Rule ids are 1-32 lowercase letters, digits or dashes",
		),
	label: z.string().trim().min(1).max(64),
	enabled: z.boolean(),
	// Evaluated on hourly rollups: the window widens to the start of the hour
	// it begins in, so a 15-minute rule looks at 15 to 75 minutes of traffic.
	windowMinutes: z.number().int().min(5).max(1440),
	// Gateway + upstream errors over requests that were not client errors.
	errorRatePercent: z.number().min(1).max(100),
	// Non-client-error requests the key needs in the window to be judged.
	minRequests: z.number().int().min(1).max(100_000),
	// Minimum time between two alerts for the same rule and provider key.
	cooldownMinutes: z.number().int().min(5).max(10_080),
	// When false, attempts the gateway retried elsewhere count neither as
	// requests nor as errors: a key that fails but falls back cleanly is quiet.
	includeRetriedErrors: z.boolean().default(false),
	// When false, requests the caller got wrong (4xx client errors) count
	// neither as requests nor as errors.
	includeClientErrors: z.boolean().default(true),
});

export type ProviderKeyAlertRule = z.infer<typeof providerKeyAlertRuleSchema>;

/** Starting values for a rule added in the dashboard; nothing ships enabled. */
export const PROVIDER_KEY_ALERT_RULE_TEMPLATE: Omit<
	ProviderKeyAlertRule,
	"id"
> = {
	label: "New rule",
	enabled: true,
	windowMinutes: 60,
	errorRatePercent: 30,
	minRequests: 20,
	cooldownMinutes: 120,
	includeRetriedErrors: false,
	includeClientErrors: true,
};

/**
 * Which credentials a rule judges: the organization's own keys, the platform
 * credentials serving its credit traffic (grouped per provider), or both.
 */
export const PROVIDER_KEY_ALERT_SOURCES = ["byok", "platform", "any"] as const;
export type ProviderKeyAlertSource =
	(typeof PROVIDER_KEY_ALERT_SOURCES)[number];

export const providerKeyAlertSettingsSchema = z.object({
	// Master switch; nothing is evaluated while off.
	enabled: z.boolean(),
	keySource: z.enum(PROVIDER_KEY_ALERT_SOURCES).default("byok"),
	inApp: z.boolean(),
	email: z.boolean(),
	channels: z.array(z.enum(["slack"])),
	rules: z
		.array(providerKeyAlertRuleSchema)
		.max(PROVIDER_KEY_ALERTS_MAX_RULES)
		.superRefine((rules, ctx) => {
			const ids = new Set<string>();
			for (const rule of rules) {
				if (ids.has(rule.id)) {
					ctx.addIssue({
						code: "custom",
						message: `Duplicate rule id "${rule.id}"`,
					});
				}
				ids.add(rule.id);
			}
		}),
});

export type ProviderKeyAlertSettings = z.infer<
	typeof providerKeyAlertSettingsSchema
>;

/** Unconfigured organizations: off, no rules, so nothing alerts until set up. */
export const DEFAULT_PROVIDER_KEY_ALERT_SETTINGS: ProviderKeyAlertSettings = {
	enabled: false,
	keySource: "byok",
	inApp: true,
	email: true,
	channels: [],
	rules: [],
};
