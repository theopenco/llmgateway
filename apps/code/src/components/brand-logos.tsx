import { cn } from "@/lib/utils";

import type { ReactElement } from "react";

interface MarkProps {
	size?: number;
}

/**
 * Brand marks are intentionally plain inline SVG (no lucide, no client hooks) so
 * the exact same components render in the DOM and inside `next/og`'s Satori
 * renderer for the dynamic OpenGraph images. Gradient ids are namespaced per
 * brand to avoid `url(#id)` collisions when several marks share a document.
 */

export function DevPassMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.4}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<polyline points="16 18 22 12 16 6" />
			<polyline points="8 6 2 12 8 18" />
		</svg>
	);
}

export function CursorMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 466.73 532.09"
			aria-hidden="true"
		>
			<path
				d="M457.43 125.94 244.42 2.96c-6.84-3.95-15.28-3.95-22.12 0L9.3 125.94C3.55 129.26 0 135.4 0 142.05v247.99c0 6.65 3.55 12.79 9.3 16.11l213.01 122.98c6.84 3.95 15.28 3.95 22.12 0l213.01-122.98c5.75-3.32 9.3-9.46 9.3-16.11V142.05c0-6.65-3.55-12.79-9.3-16.11zm-13.38 26.05L238.42 508.15c-1.39 2.4-5.06 1.42-5.06-1.36V273.58c0-4.66-2.49-8.97-6.53-11.31L24.87 145.67c-2.4-1.39-1.42-5.06 1.36-5.06h411.26c5.84 0 9.49 6.33 6.57 11.39h-.01Z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function OpenCodeGoMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 54 30"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path d="M24 30H0V0h24v6H6v18h12v-6h-6v-6h12z" fill="currentColor" />
			<path
				d="M12 18h6v6H6V12h6zM48 12v12H36V12z"
				fill="currentColor"
				opacity={0.45}
			/>
			<path d="M54 30H30V0h24zm-18-6h12V6H36z" fill="currentColor" />
		</svg>
	);
}

export function OpenCodeZenMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 84 30"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M24 24H6v-6h12v-6h6zM6 18H0v-6h6z"
				fill="currentColor"
				opacity={0.45}
			/>
			<path
				d="M6 24h18v6H0V18h6zm12-6H6v-6h12zm6-6h-6V6H0V0h24z"
				fill="currentColor"
			/>
			<path d="M54 18v6H36v-6z" fill="currentColor" opacity={0.45} />
			<path d="M54 18H36v6h18v6H30V0h24zm-18-6h12V6H36z" fill="currentColor" />
			<path d="M78 30H66V12h12z" fill="currentColor" opacity={0.45} />
			<path d="M78 6H66v24h-6V0h18zm6 24h-6V6h6z" fill="currentColor" />
		</svg>
	);
}

export function FireworksMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 638 315"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M318.563 221.755c-17.7 0-33.584-10.508-40.357-26.777L196.549 0h47.793l74.5 178.361L393.273 0h47.793L358.92 195.048c-6.808 16.199-22.657 26.707-40.357 26.707M425.111 314.933c-17.63 0-33.444-10.439-40.287-26.567-6.877-16.269-3.317-34.842 9.112-47.445L542.657 90.2803l18.572 43.8137-136.153 137.654 194.071-1.082 18.573 43.813-212.574.524-.07-.07zM0 314.408l18.5727-43.813 194.0703 1.082L76.525 133.988l18.5727-43.8132L243.819 240.816c12.428 12.568 16.024 31.21 9.111 47.444-6.842 16.164-22.727 26.567-40.287 26.567L.0698221 314.339z"
				fill="#6720ff"
			/>
		</svg>
	);
}

export function ZaiMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 161 129"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M161 0h-59.685L0 129h59.6854L161 0ZM148.564 109.447H89.5L74 129.001h59.064l15.5-19.554ZM84.5635-.00018068H25.5L10 19.5536h59.0635l15.5-19.55378068Z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function QwenMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 200 200"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M174.82 108.75 155.38 75l10.26-17.25c.82-1.44.82-3.22 0-4.66l-10.26-17.25c-.52-.93-1.51-1.51-2.6-1.51h-37.9l-8.74-15.3c-.52-.93-1.51-1.51-2.6-1.51H83.3c-1.09 0-2.08.58-2.6 1.51L61.26 52.77H41.02c-1.09 0-2.08.58-2.6 1.51L28.16 71.53c-.82 1.44-.82 3.22 0 4.66l17.36 31.31-8.74 15.3c-.82 1.44-.82 3.22 0 4.66l10.26 17.25c.52.93 1.51 1.51 2.6 1.51h37.9l8.74 15.3c.52.93 1.51 1.51 2.6 1.51h20.24c1.09 0 2.08-.58 2.6-1.51l19.44-33.74h17.36c1.09 0 2.08-.58 2.6-1.51l10.26-17.25c.82-1.44.82-3.22 0-4.66z"
				fill="url(#qwenGradA)"
			/>
			<path
				d="M119.12 163.03H98.88l-11.34-18.32h-37.9l11.62-18.32H80.7l-42.28-71.1h22.84L83.3 19.03l10.26 18.32L83.3 55.29h78.28l-10.26 17.25 19.44 33.74h-19.44l-10.16-17.94-39.98 74.69z"
				fill="#fff"
			/>
			<path d="M127.86 79.83H76.14l25.04 42.28z" fill="url(#qwenGradB)" />
			<defs>
				<radialGradient
					id="qwenGradA"
					cx="0"
					cy="0"
					r="1"
					gradientUnits="userSpaceOnUse"
					gradientTransform="rotate(90 0 100)scale(100)"
				>
					<stop stopColor="#665cee" />
					<stop offset="1" stopColor="#332e91" />
				</radialGradient>
				<radialGradient
					id="qwenGradB"
					cx="0"
					cy="0"
					r="1"
					gradientUnits="userSpaceOnUse"
					gradientTransform="rotate(90 0 100)scale(100)"
				>
					<stop stopColor="#665cee" />
					<stop offset="1" stopColor="#332e91" />
				</radialGradient>
			</defs>
		</svg>
	);
}

export interface BrandSpec {
	label: string;
	/** Tile background. For `devpass` the DOM tile is theme-aware; this value is
	 * what the (always-dark) OpenGraph renderer uses. */
	bg: string;
	/** Mark color (only affects `currentColor` marks) / monogram color. */
	fg: string;
	/** Fraction of the tile the mark occupies — tuned per logo aspect ratio. */
	scale: number;
	/** When true the DOM tile is theme-aware (like `devpass`): the mark uses
	 * `currentColor` and the tile flips with the site's light/dark theme. The
	 * fixed `bg`/`fg` are then used only by the always-dark OpenGraph renderer. */
	adaptive?: boolean;
	Mark?: (props: MarkProps) => ReactElement;
	/** Single-glyph fallback when there is no dedicated mark. */
	mono?: string;
}

export const BRAND: Record<string, BrandSpec> = {
	devpass: {
		label: "DevPass",
		bg: "#fafafa",
		fg: "#0a0a0b",
		scale: 0.56,
		Mark: DevPassMark,
	},
	cursor: {
		label: "Cursor",
		bg: "#0a0a0b",
		fg: "#ffffff",
		scale: 0.52,
		Mark: CursorMark,
	},
	"opencode-go": {
		label: "OpenCode Go",
		bg: "#18181b",
		fg: "#f1ecec",
		scale: 0.64,
		adaptive: true,
		Mark: OpenCodeGoMark,
	},
	"opencode-zen": {
		label: "OpenCode Zen",
		bg: "#18181b",
		fg: "#f1ecec",
		scale: 0.78,
		adaptive: true,
		Mark: OpenCodeZenMark,
	},
	fireworks: {
		label: "Fireworks",
		bg: "#0a0a0b",
		fg: "#6720ff",
		scale: 0.74,
		Mark: FireworksMark,
	},
	zai: {
		label: "z.ai",
		bg: "#0a0a0b",
		fg: "#ffffff",
		scale: 0.62,
		Mark: ZaiMark,
	},
	qwen: {
		label: "Qwen",
		bg: "#0a0a0b",
		fg: "#a5b4fc",
		scale: 0.72,
		Mark: QwenMark,
	},
};

const FALLBACK: BrandSpec = {
	label: "",
	bg: "#27272a",
	fg: "#e4e4e7",
	scale: 0.5,
};

export function getBrand(key?: string): BrandSpec {
	return (key && BRAND[key]) || FALLBACK;
}

/**
 * Rounded brand tile for use in the DOM. `devpass` is rendered theme-aware so it
 * reads correctly on both the light and dark site themes; every other brand uses
 * its fixed brand color.
 */
export function BrandTile({
	brand,
	size = 48,
	radius = 14,
	className,
}: {
	brand: string;
	size?: number;
	radius?: number;
	className?: string;
}): ReactElement {
	const spec = getBrand(brand);
	const inner = Math.round(size * spec.scale);
	const themeAware = brand === "devpass" || spec.adaptive === true;
	const Mark = spec.Mark;

	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden",
				themeAware
					? "bg-foreground text-background"
					: "ring-1 ring-inset ring-white/10",
				className,
			)}
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				...(themeAware ? {} : { backgroundColor: spec.bg, color: spec.fg }),
			}}
		>
			{Mark ? (
				<Mark size={inner} />
			) : (
				<span
					style={{
						fontSize: Math.round(inner * 0.82),
						fontWeight: 700,
						lineHeight: 1,
					}}
				>
					{spec.mono ?? spec.label.charAt(0)}
				</span>
			)}
		</div>
	);
}
