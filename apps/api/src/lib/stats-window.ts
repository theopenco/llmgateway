import { z } from "zod";

/**
 * Rolling lookback windows shared by the admin analytics endpoints.
 */
export const tokenWindowSchema = z.enum([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

export type TokenWindow = z.infer<typeof tokenWindowSchema>;

export function getTokenWindowStartDate(window: string): Date {
	const windowMs: Record<string, number> = {
		"1h": 60 * 60 * 1000,
		"4h": 4 * 60 * 60 * 1000,
		"12h": 12 * 60 * 60 * 1000,
		"1d": 24 * 60 * 60 * 1000,
		"7d": 7 * 24 * 60 * 60 * 1000,
		"30d": 30 * 24 * 60 * 60 * 1000,
		"90d": 90 * 24 * 60 * 60 * 1000,
		"365d": 365 * 24 * 60 * 60 * 1000,
	};
	const ms = windowMs[window] ?? 7 * 24 * 60 * 60 * 1000;
	return new Date(Date.now() - ms);
}

/**
 * Bucket granularity for a window. Short windows keep the hourly grain the
 * stats tables are stored at; longer ones roll up to days so a 365d chart does
 * not return 8760 points.
 */
export function getBucketUnitForWindow(window: string): "hour" | "day" {
	if (
		window === "1h" ||
		window === "4h" ||
		window === "12h" ||
		window === "1d"
	) {
		return "hour";
	}
	return "day";
}
