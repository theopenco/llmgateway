export function AspectRatioIcon({
	ratio,
	className = "",
}: {
	ratio: string;
	className?: string;
}) {
	const maxSize = 14;
	let w: number;
	let h: number;

	if (ratio === "auto") {
		w = maxSize;
		h = maxSize;
	} else {
		const [rw, rh] = ratio.split(":").map(Number);
		const scale = maxSize / Math.max(rw, rh);
		w = Math.max(4, Math.round(rw * scale));
		h = Math.max(4, Math.round(rh * scale));
	}

	return (
		<svg
			width={maxSize}
			height={maxSize}
			viewBox={`0 0 ${maxSize} ${maxSize}`}
			className={`shrink-0 ${className}`}
		>
			<rect
				x={(maxSize - w) / 2}
				y={(maxSize - h) / 2}
				width={w}
				height={h}
				rx={1}
				fill="none"
				stroke="currentColor"
				strokeWidth={1.5}
			/>
		</svg>
	);
}
