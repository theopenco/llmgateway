import type { CSSProperties } from "react";

// lucide "plane" silhouette, filled. Points 45° up-right in its 24x24 box.
const PLANE_PATH =
	"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";

// rotate(45) turns the glyph to point along +x, the direction animateMotion faces.
const PLANE_TRANSFORM = "scale(1.35) rotate(45) translate(-12 -12)";

function Cloud({
	className,
	style,
}: {
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<svg viewBox="0 0 120 48" className={className} style={style}>
			<g fill="currentColor">
				<circle cx="34" cy="30" r="13" />
				<circle cx="56" cy="22" r="17" />
				<circle cx="80" cy="30" r="12" />
				<rect x="21" y="28" width="72" height="15" rx="7.5" />
			</g>
		</svg>
	);
}

/** Ambient aviation scene behind the hero: radar sweep, climbing plane, clouds, approach lights. */
export function HeroScene() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 overflow-hidden"
		>
			{/* Radar scope, half off the top-right corner */}
			<div className="absolute -top-28 -right-28 size-[34rem] opacity-60 max-lg:hidden">
				<div className="border-foreground/10 absolute inset-0 rounded-full border" />
				<div className="border-foreground/10 absolute inset-[15%] rounded-full border" />
				<div className="border-foreground/10 absolute inset-[30%] rounded-full border" />
				<div className="border-foreground/10 absolute inset-[45%] rounded-full border" />
				<div className="bg-foreground/15 absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" />
				<div className="animate-radar-sweep radar-sweep-cone absolute inset-0 rounded-full motion-reduce:animate-none" />
				<div
					className="bg-signal animate-blip absolute top-[30%] left-[36%] size-1.5 rounded-full motion-reduce:animate-none"
					style={{ animationDelay: "1.6s" }}
				/>
				<div
					className="bg-signal animate-blip absolute top-[62%] left-[24%] size-1.5 rounded-full motion-reduce:animate-none"
					style={{ animationDelay: "4.1s" }}
				/>
			</div>

			{/* Drifting clouds */}
			<Cloud className="text-foreground animate-cloud-drift absolute top-[16%] left-[4%] w-44 opacity-5 motion-reduce:animate-none" />
			<Cloud
				className="text-foreground animate-cloud-drift absolute top-[74%] left-[44%] w-60 opacity-5 motion-reduce:animate-none"
				style={{ animationDelay: "-14s", animationDuration: "46s" }}
			/>
			<Cloud
				className="text-foreground animate-cloud-drift absolute top-[38%] right-[8%] w-32 opacity-5 max-lg:hidden motion-reduce:animate-none"
				style={{ animationDelay: "-27s", animationDuration: "52s" }}
			/>

			{/* Flight path + climbing plane, in the open sky above the headline */}
			<svg
				className="absolute inset-0 h-full w-full max-lg:hidden"
				viewBox="0 0 1200 560"
				preserveAspectRatio="xMidYMid slice"
				fill="none"
			>
				<path
					id="hero-flight-path"
					d="M-40 135 C 300 126 600 104 850 80 C 1000 66 1120 55 1250 42"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeDasharray="2 16"
					className="text-foreground/25 animate-flight-dashes motion-reduce:animate-none"
				/>
				<g className="text-foreground/70 motion-reduce:hidden">
					<g transform={PLANE_TRANSFORM}>
						<path d={PLANE_PATH} fill="currentColor" />
					</g>
					<animateMotion dur="16s" repeatCount="indefinite" rotate="auto">
						<mpath href="#hero-flight-path" />
					</animateMotion>
				</g>
				{/* Static plane for reduced motion */}
				<g
					className="text-foreground/70 hidden motion-reduce:block"
					transform="translate(640 105) rotate(-8)"
				>
					<g transform={PLANE_TRANSFORM}>
						<path d={PLANE_PATH} fill="currentColor" />
					</g>
				</g>
			</svg>

			{/* Approach-light strobe chase, running toward the runway-line below */}
			<div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 sm:gap-5">
				{Array.from({ length: 14 }, (_, i) => (
					<span
						key={i}
						className="bg-primary animate-strobe size-1.5 rounded-full opacity-20 motion-reduce:animate-none"
						style={{ animationDelay: `${i * 0.12}s` }}
					/>
				))}
			</div>
		</div>
	);
}
