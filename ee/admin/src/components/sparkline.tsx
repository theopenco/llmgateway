import { cn } from "@/lib/utils";

/**
 * Tiny inline trend marks for table cells. Deliberately hand-rolled SVG rather
 * than recharts: a credentials table renders two of these per row, and a
 * `ResponsiveContainer` per cell would put a ResizeObserver behind every one of
 * them for a 60×16px figure with no axes.
 *
 * Both variants take `currentColor`, so the caller sets the series colour with a
 * text class and light/dark follow the theme automatically.
 */

const WIDTH = 60;
const HEIGHT = 16;

export interface SparklinePoint {
	/** Native hover label for this point; the marks are too small for a tooltip. */
	label: string;
}

/**
 * Per-bucket magnitude — one bar per day. Bars, not a line: a day's spend is a
 * quantity, and discrete bars also keep this from reading as another meter next
 * to the spend-limit track.
 */
export function SparklineBars({
	values,
	points,
	className,
	ariaLabel,
}: {
	values: number[];
	points?: SparklinePoint[];
	className?: string;
	ariaLabel: string;
}) {
	const max = Math.max(...values, 0);
	if (values.length === 0 || max <= 0) {
		return null;
	}

	const gap = 2;
	const gapTotal = gap * (values.length - 1);
	const barWidth = (WIDTH - gapTotal) / values.length;

	return (
		<svg
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			width={WIDTH}
			height={HEIGHT}
			className={cn("overflow-visible", className)}
			role="img"
			aria-label={ariaLabel}
		>
			{values.map((value, index) => {
				// A non-zero day always keeps a visible sliver, so "tiny" never renders
				// identically to "nothing happened".
				const height = value > 0 ? Math.max((value / max) * HEIGHT, 1.5) : 0;
				return (
					<rect
						key={index}
						x={index * (barWidth + gap)}
						y={HEIGHT - height}
						width={barWidth}
						height={height}
						rx={1}
						fill="currentColor"
						opacity={index === values.length - 1 ? 1 : 0.55}
					>
						{points?.[index] ? <title>{points[index].label}</title> : null}
					</rect>
				);
			})}
		</svg>
	);
}

/**
 * A rate over time. `null` breaks the line instead of drawing zero: a day with
 * no traffic has no error rate, and flattening it to 0% would claim the
 * credential was healthy that day.
 *
 * `max` is supplied by the caller rather than derived from the data so the
 * height means the same thing on every row — auto-scaling would draw a
 * credential's 0.5% blip exactly like another's total outage.
 */
export function SparklineLine({
	values,
	max,
	points,
	className,
	ariaLabel,
}: {
	values: (number | null)[];
	max: number;
	points?: SparklinePoint[];
	className?: string;
	ariaLabel: string;
}) {
	if (values.length < 2 || max <= 0) {
		return null;
	}

	const stepX = WIDTH / (values.length - 1);
	// 1px of padding top and bottom keeps a 0% run and a clipped 100% spike both
	// inside the box instead of half-drawn on the edge.
	const plotHeight = HEIGHT - 2;
	const toY = (value: number) => {
		const scaled = Math.min(value / max, 1) * plotHeight;
		return HEIGHT - 1 - scaled;
	};

	const segments: { x: number; y: number }[][] = [];
	values.forEach((value, index) => {
		if (value === null) {
			segments.push([]);
			return;
		}
		const point = { x: index * stepX, y: toY(value) };
		const current = segments[segments.length - 1];
		if (current && current.length > 0) {
			current.push(point);
		} else {
			segments.push([point]);
		}
	});

	const drawn = segments.filter((segment) => segment.length > 0);
	if (drawn.length === 0) {
		return null;
	}

	return (
		<svg
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			width={WIDTH}
			height={HEIGHT}
			className={cn("overflow-visible", className)}
			role="img"
			aria-label={ariaLabel}
		>
			{drawn.map((segment, index) =>
				segment.length === 1 ? (
					<circle
						key={index}
						cx={segment[0].x}
						cy={segment[0].y}
						r={1.25}
						fill="currentColor"
					/>
				) : (
					<polyline
						key={index}
						points={segment.map(({ x, y }) => `${x},${y}`).join(" ")}
						fill="none"
						stroke="currentColor"
						strokeWidth={1.25}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				),
			)}
			{points?.map((point, index) => (
				// Invisible hit targets: the line itself is 1.25px and unhoverable.
				<rect
					key={`hit-${index}`}
					x={(index - 0.5) * stepX}
					y={0}
					width={stepX}
					height={HEIGHT}
					fill="transparent"
				>
					<title>{point.label}</title>
				</rect>
			))}
		</svg>
	);
}
