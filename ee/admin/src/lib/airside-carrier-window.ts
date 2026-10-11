/** Windows the Airside carriers table can show traffic over. */
export type CarrierWindow = "24h" | "7d" | "30d";

export const DEFAULT_CARRIER_WINDOW: CarrierWindow = "7d";

export const CARRIER_WINDOW_OPTIONS: {
	value: CarrierWindow;
	label: string;
	/** What one sparkline bar covers. */
	bucket: string;
}[] = [
	{ value: "24h", label: "last 24 hours", bucket: "hour" },
	{ value: "7d", label: "last 7 days", bucket: "UTC day" },
	{ value: "30d", label: "last 30 days", bucket: "UTC day" },
];

export function parseCarrierWindow(
	value: string | null | undefined,
): CarrierWindow {
	return (
		CARRIER_WINDOW_OPTIONS.find((option) => option.value === value)?.value ??
		DEFAULT_CARRIER_WINDOW
	);
}

export function carrierWindowOption(window: CarrierWindow) {
	return (
		CARRIER_WINDOW_OPTIONS.find((option) => option.value === window) ??
		CARRIER_WINDOW_OPTIONS[1]
	);
}
