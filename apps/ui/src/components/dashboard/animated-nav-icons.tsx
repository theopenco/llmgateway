"use client";

import { motion } from "framer-motion";

export interface AnimatedIconProps {
	isHovered: boolean;
}

const svgProps = {
	xmlns: "http://www.w3.org/2000/svg",
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
};

// LayoutDashboard — staggered rect bounce
export function AnimatedLayoutDashboard({ isHovered }: AnimatedIconProps) {
	const rects = [
		{ width: 7, height: 9, x: 3, y: 3, rx: 1 },
		{ width: 7, height: 5, x: 14, y: 3, rx: 1 },
		{ width: 7, height: 9, x: 14, y: 12, rx: 1 },
		{ width: 7, height: 5, x: 3, y: 16, rx: 1 },
	];

	return (
		<svg {...svgProps}>
			{rects.map((rect, i) => (
				<motion.rect
					key={i}
					{...rect}
					initial={false}
					animate={
						isHovered ? { translateY: [0, -1.5, 0], opacity: [1, 0.6, 1] } : {}
					}
					transition={{ duration: 0.3, delay: i * 0.06, ease: "easeInOut" }}
				/>
			))}
		</svg>
	);
}

// Activity — heartbeat line draws itself
export function AnimatedActivity({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
				initial={false}
				animate={isHovered ? { pathLength: [0, 1] } : { pathLength: 1 }}
				transition={{ duration: 0.5, ease: "easeInOut" }}
			/>
		</svg>
	);
}

// ChartColumnBig — bars grow from bottom
export function AnimatedChartColumnBig({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<path d="M3 3v16a2 2 0 0 0 2 2h16" />
			<motion.rect
				x={7}
				y={8}
				width={4}
				height={9}
				rx={1}
				initial={false}
				animate={isHovered ? { scaleY: [0, 1.1, 1] } : { scaleY: 1 }}
				transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
				style={{ transformOrigin: "bottom", transformBox: "fill-box" }}
			/>
			<motion.rect
				x={15}
				y={5}
				width={4}
				height={12}
				rx={1}
				initial={false}
				animate={isHovered ? { scaleY: [0, 1.1, 1] } : { scaleY: 1 }}
				transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
				style={{ transformOrigin: "bottom", transformBox: "fill-box" }}
			/>
		</svg>
	);
}

// BarChart3 (ChartColumn) — vertical bar lines draw upward
export function AnimatedBarChart3({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<path d="M3 3v16a2 2 0 0 0 2 2h16" />
			<motion.path
				d="M8 17v-3"
				initial={false}
				animate={isHovered ? { pathLength: [0, 1] } : { pathLength: 1 }}
				transition={{ duration: 0.3, delay: 0, ease: "easeOut" }}
			/>
			<motion.path
				d="M13 17V5"
				initial={false}
				animate={isHovered ? { pathLength: [0, 1] } : { pathLength: 1 }}
				transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
			/>
			<motion.path
				d="M18 17V9"
				initial={false}
				animate={isHovered ? { pathLength: [0, 1] } : { pathLength: 1 }}
				transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
			/>
		</svg>
	);
}

// Key — rotates like turning a lock
export function AnimatedKey({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.g
				initial={false}
				animate={isHovered ? { rotate: [0, -15, 8, 0] } : { rotate: 0 }}
				transition={{ duration: 0.5, ease: "easeInOut" }}
				style={{ transformOrigin: "7.5px 15.5px" }}
			>
				<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
				<path d="m21 2-9.6 9.6" />
				<circle cx="7.5" cy="15.5" r="5.5" />
			</motion.g>
		</svg>
	);
}

// Settings — gear rotates, center circle stays
export function AnimatedSettings({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
				initial={false}
				animate={isHovered ? { rotate: 180 } : { rotate: 0 }}
				transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
				style={{ transformOrigin: "12px 12px" }}
			/>
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

// KeyRound — key body jiggles, dot pulses
export function AnimatedKeyRound({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
				initial={false}
				animate={isHovered ? { rotate: [0, -8, 5, -3, 0] } : { rotate: 0 }}
				transition={{ duration: 0.5, ease: "easeInOut" }}
				style={{ transformOrigin: "12px 12px" }}
			/>
			<motion.circle
				cx="16.5"
				cy="7.5"
				r=".5"
				fill="currentColor"
				initial={false}
				animate={isHovered ? { scale: [1, 2, 1] } : { scale: 1 }}
				transition={{ duration: 0.3, delay: 0.1 }}
				style={{ transformOrigin: "16.5px 7.5px" }}
			/>
		</svg>
	);
}

// Shield — protective pulse
export function AnimatedShield({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
				initial={false}
				animate={isHovered ? { scale: [1, 1.12, 1] } : { scale: 1 }}
				transition={{ duration: 0.4, ease: "easeInOut" }}
				style={{ transformOrigin: "12px 12px" }}
			/>
		</svg>
	);
}

// ShieldAlert — shield steady, exclamation shakes
export function AnimatedShieldAlert({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
			<motion.path
				d="M12 8v4"
				initial={false}
				animate={
					isHovered ? { translateX: [0, -1, 1, -1, 1, 0] } : { translateX: 0 }
				}
				transition={{ duration: 0.4, ease: "easeInOut" }}
			/>
			<motion.path
				d="M12 16h.01"
				initial={false}
				animate={isHovered ? { scale: [1, 1.8, 1] } : { scale: 1 }}
				transition={{ duration: 0.3, delay: 0.1 }}
				style={{ transformOrigin: "12px 16px" }}
			/>
		</svg>
	);
}

// MessageSquare — bubble bounces
export function AnimatedMessageSquare({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
				initial={false}
				animate={isHovered ? { translateY: [0, -2, 0] } : { translateY: 0 }}
				transition={{ duration: 0.3, ease: "easeInOut" }}
			/>
		</svg>
	);
}

// BotMessageSquare — eyes blink, antenna wiggles, ears extend
export function AnimatedBotMessageSquare({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M12 6V2H8"
				initial={false}
				animate={isHovered ? { rotate: [0, -10, 10, -5, 0] } : { rotate: 0 }}
				transition={{ duration: 0.5, ease: "easeInOut" }}
				style={{ transformOrigin: "12px 6px" }}
			/>
			<motion.path
				d="M15 11v2"
				initial={false}
				animate={isHovered ? { scaleY: [1, 0.1, 1] } : { scaleY: 1 }}
				transition={{ duration: 0.3, delay: 0.15 }}
				style={{ transformOrigin: "center", transformBox: "fill-box" }}
			/>
			<motion.path
				d="M2 12h2"
				initial={false}
				animate={isHovered ? { translateX: [0, -1.5, 0] } : { translateX: 0 }}
				transition={{ duration: 0.3, ease: "easeInOut" }}
			/>
			<motion.path
				d="M20 12h2"
				initial={false}
				animate={isHovered ? { translateX: [0, 1.5, 0] } : { translateX: 0 }}
				transition={{ duration: 0.3, ease: "easeInOut" }}
			/>
			<path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
			<motion.path
				d="M9 11v2"
				initial={false}
				animate={isHovered ? { scaleY: [1, 0.1, 1] } : { scaleY: 1 }}
				transition={{ duration: 0.3, delay: 0.15 }}
				style={{ transformOrigin: "center", transformBox: "fill-box" }}
			/>
		</svg>
	);
}

// ExternalLink — arrow shoots out diagonally
export function AnimatedExternalLink({ isHovered }: AnimatedIconProps) {
	return (
		<svg {...svgProps}>
			<motion.path
				d="M15 3h6v6"
				initial={false}
				animate={
					isHovered
						? { translateX: [0, 2, 0], translateY: [0, -2, 0] }
						: { translateX: 0, translateY: 0 }
				}
				transition={{ duration: 0.3, ease: "easeInOut" }}
			/>
			<motion.path
				d="M10 14 21 3"
				initial={false}
				animate={
					isHovered
						? { translateX: [0, 2, 0], translateY: [0, -2, 0] }
						: { translateX: 0, translateY: 0 }
				}
				transition={{ duration: 0.3, ease: "easeInOut" }}
			/>
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
		</svg>
	);
}
