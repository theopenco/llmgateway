import type { TimeRangeValue } from "@/components/time-range-picker";

// Single source of truth for the ranges offered on the agents dashboard,
// shared between the server page (URL parsing) and the client view.
export const AGENT_TIME_RANGES = [
	"1h",
	"4h",
	"24h",
	"7d",
	"30d",
] as const satisfies readonly TimeRangeValue[];

export const AGENT_TIME_RANGE_HOURS: Record<TimeRangeValue, number> = {
	"1h": 1,
	"4h": 4,
	"24h": 24,
	"7d": 7 * 24,
	"30d": 30 * 24,
};

export function parseAgentTimeRange(
	value: string | null | undefined,
): TimeRangeValue {
	return (AGENT_TIME_RANGES as readonly string[]).includes(value ?? "")
		? (value as TimeRangeValue)
		: "7d";
}
