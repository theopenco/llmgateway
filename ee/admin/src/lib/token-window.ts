import type { TokenWindow } from "@/lib/types";

export const TOKEN_WINDOW_DAYS: Record<TokenWindow, number> = {
	"1h": 1 / 24,
	"4h": 4 / 24,
	"12h": 0.5,
	"1d": 1,
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"365d": 365,
};

export function isTokenWindow(
	value: string | null | undefined,
): value is TokenWindow {
	return typeof value === "string" && Object.hasOwn(TOKEN_WINDOW_DAYS, value);
}

export function parseTokenWindow(
	value: string | null | undefined,
	fallback: TokenWindow = "1d",
): TokenWindow {
	return isTokenWindow(value) ? value : fallback;
}
