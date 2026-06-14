import { cn } from "@/lib/utils";

import type { ReactElement } from "react";

interface MarkProps {
	size?: number;
}

/**
 * Brand marks are intentionally plain inline SVG (no `currentColor`-less fills,
 * no lucide, no client hooks) so the exact same components render in the DOM and
 * inside `next/og`'s Satori renderer for the dynamic OpenGraph images.
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

export function OpenCodeMark({ size = 28 }: MarkProps): ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 240 300"
			fill="none"
			aria-hidden="true"
		>
			<path d="M180 240H60V120h120z" fill="currentColor" opacity={0.5} />
			<path d="M180 60H60v180h120zm60 240H0V0h240z" fill="currentColor" />
		</svg>
	);
}

export interface BrandSpec {
	label: string;
	/** Tile background. For `devpass` the DOM tile is theme-aware; this value is
	 * what the (always-dark) OpenGraph renderer uses. */
	bg: string;
	/** Mark / monogram color. */
	fg: string;
	Mark?: (props: MarkProps) => ReactElement;
	/** Single-glyph fallback when there is no dedicated mark. */
	mono?: string;
}

export const BRAND: Record<string, BrandSpec> = {
	devpass: {
		label: "DevPass",
		bg: "#fafafa",
		fg: "#0a0a0b",
		Mark: DevPassMark,
	},
	cursor: { label: "Cursor", bg: "#0a0a0b", fg: "#ffffff", Mark: CursorMark },
	opencode: {
		label: "OpenCode",
		bg: "#0a0a0b",
		fg: "#ffffff",
		Mark: OpenCodeMark,
	},
	fireworks: { label: "Fireworks", bg: "#2e1065", fg: "#c4b5fd", mono: "F" },
	zai: { label: "z.ai", bg: "#0c2d6b", fg: "#93c5fd", mono: "z" },
	qwen: { label: "Qwen", bg: "#312e81", fg: "#a5b4fc", mono: "Q" },
};

const FALLBACK: BrandSpec = { label: "", bg: "#27272a", fg: "#e4e4e7" };

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
	const inner = Math.round(size * 0.56);
	const isDevpass = brand === "devpass";
	const Mark = spec.Mark;

	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden",
				isDevpass
					? "bg-foreground text-background"
					: "ring-1 ring-inset ring-white/10",
				className,
			)}
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				...(isDevpass ? {} : { backgroundColor: spec.bg, color: spec.fg }),
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
