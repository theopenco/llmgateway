export type PageWindow = "1h" | "2h" | "4h" | "12h" | "24h" | "2d" | "7d";

export const pageWindowOptions: { value: PageWindow; label: string }[] = [
	{ value: "1h", label: "1h" },
	{ value: "2h", label: "2h" },
	{ value: "4h", label: "4h" },
	{ value: "12h", label: "12h" },
	{ value: "24h", label: "24h" },
	{ value: "2d", label: "2d" },
	{ value: "7d", label: "7d" },
];

const validWindows = new Set<PageWindow>(pageWindowOptions.map((o) => o.value));

export function parsePageWindow(value: string | undefined): PageWindow {
	if (value && validWindows.has(value as PageWindow)) {
		return value as PageWindow;
	}
	return "4h";
}

export function windowToFromTo(window: PageWindow): {
	from: string;
	to: string;
} {
	const now = new Date();
	const windowMinutes: Record<PageWindow, number> = {
		"1h": 60,
		"2h": 120,
		"4h": 240,
		"12h": 720,
		"24h": 1440,
		"2d": 2880,
		"7d": 10080,
	};
	const minutes = windowMinutes[window];
	const ms = minutes * 60 * 1000;
	const from = new Date(now.getTime() - ms).toISOString();
	return { from, to: now.toISOString() };
}
