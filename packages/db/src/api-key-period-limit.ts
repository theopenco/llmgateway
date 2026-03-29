export const apiKeyPeriodDurationUnits = [
	"hour",
	"day",
	"week",
	"month",
] as const;

export type ApiKeyPeriodDurationUnit =
	(typeof apiKeyPeriodDurationUnits)[number];

export const apiKeyPeriodDurationMaxValues: Record<
	ApiKeyPeriodDurationUnit,
	number
> = {
	hour: 24 * 365,
	day: 365,
	week: 52,
	month: 12,
};

type UsageValue = number | string | null | undefined;

export interface ApiKeyPeriodLimitFields {
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
	currentPeriodUsage: UsageValue;
	currentPeriodStartedAt: Date | null;
}

export interface ApiKeyCurrentPeriodState {
	isConfigured: boolean;
	isExpired: boolean;
	usage: string;
	startedAt: Date | null;
	resetAt: Date | null;
}

export function isApiKeyPeriodLimitConfigured(
	fields: Pick<
		ApiKeyPeriodLimitFields,
		"periodUsageLimit" | "periodUsageDurationValue" | "periodUsageDurationUnit"
	>,
): fields is Pick<
	ApiKeyPeriodLimitFields,
	"periodUsageLimit" | "periodUsageDurationValue" | "periodUsageDurationUnit"
> & {
	periodUsageLimit: string;
	periodUsageDurationValue: number;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit;
} {
	return (
		fields.periodUsageLimit !== null &&
		fields.periodUsageDurationValue !== null &&
		fields.periodUsageDurationUnit !== null
	);
}

export function isValidApiKeyPeriodDuration(
	value: number,
	unit: ApiKeyPeriodDurationUnit,
): boolean {
	return value >= 1 && value <= apiKeyPeriodDurationMaxValues[unit];
}

export function addApiKeyPeriodDuration(
	startedAt: Date,
	value: number,
	unit: ApiKeyPeriodDurationUnit,
): Date {
	const next = new Date(startedAt);

	switch (unit) {
		case "hour":
			next.setHours(next.getHours() + value);
			return next;
		case "day":
			next.setDate(next.getDate() + value);
			return next;
		case "week": {
			const daysToAdd = value * 7;
			next.setDate(next.getDate() + daysToAdd);
			return next;
		}
		case "month": {
			const dayOfMonth = next.getDate();
			next.setDate(1);
			next.setMonth(next.getMonth() + value);
			const lastDayOfTargetMonth = new Date(
				next.getFullYear(),
				next.getMonth() + 1,
				0,
			).getDate();
			next.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
			return next;
		}
	}
}

export function getApiKeyCurrentPeriodState(
	fields: ApiKeyPeriodLimitFields,
	now: Date = new Date(),
): ApiKeyCurrentPeriodState {
	if (!isApiKeyPeriodLimitConfigured(fields)) {
		return {
			isConfigured: false,
			isExpired: false,
			usage: "0",
			startedAt: null,
			resetAt: null,
		};
	}

	if (!fields.currentPeriodStartedAt) {
		return {
			isConfigured: true,
			isExpired: false,
			usage: "0",
			startedAt: null,
			resetAt: null,
		};
	}

	const resetAt = addApiKeyPeriodDuration(
		fields.currentPeriodStartedAt,
		fields.periodUsageDurationValue,
		fields.periodUsageDurationUnit,
	);

	if (now >= resetAt) {
		return {
			isConfigured: true,
			isExpired: true,
			usage: "0",
			startedAt: null,
			resetAt: null,
		};
	}

	return {
		isConfigured: true,
		isExpired: false,
		usage: String(fields.currentPeriodUsage ?? "0"),
		startedAt: fields.currentPeriodStartedAt,
		resetAt,
	};
}
