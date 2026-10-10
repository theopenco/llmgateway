import { palettes } from "@/lib/colors";

function luminance(hex: string) {
	const rgb = [1, 3, 5].map(
		(offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
	);
	const linear = rgb.map((value) =>
		value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
	);
	return linear
		.map((value, index) => value * [0.2126, 0.7152, 0.0722][index])
		.reduce((sum, value) => sum + value, 0);
}
function contrast(a: string, b: string) {
	const first = luminance(a);
	const second = luminance(b);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.each(["light", "dark"] as const)(
	"%s text and controls meet contrast requirements",
	(scheme) => {
		const palette = palettes[scheme];
		for (const background of [palette.background, palette.panel]) {
			for (const foreground of [
				palette.text,
				palette.muted,
				palette.accent,
				palette.error,
			]) {
				expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
			}
			expect(contrast(palette.border, background)).toBeGreaterThanOrEqual(3);
		}
		expect(contrast(palette.ink, palette.accent)).toBeGreaterThanOrEqual(4.5);
	},
);
