"use client";

import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

import { randomFloatBetween } from "@llmgateway/shared/random";

import type { RefObject } from "react";

export interface AnimatedBeamProps {
	className?: string;
	containerRef: RefObject<HTMLElement | null>; // Container ref
	fromRef: RefObject<HTMLElement | null>;
	toRef: RefObject<HTMLElement | null>;
	curvature?: number;
	reverse?: boolean;
	pathColor?: string;
	pathWidth?: number;
	pathOpacity?: number;
	gradientStartColor?: string;
	gradientStopColor?: string;
	delay?: number;
	duration?: number;
	startXOffset?: number;
	startYOffset?: number;
	endXOffset?: number;
	endYOffset?: number;
}

export const AnimatedBeam: React.FC<AnimatedBeamProps> = ({
	className,
	containerRef,
	fromRef,
	toRef,
	curvature = 0,
	reverse = false, // Include the reverse prop
	duration,
	delay = 0,
	pathColor = "gray",
	pathWidth = 2,
	pathOpacity = 0.2,
	gradientStartColor = "#ffaa40",
	gradientStopColor = "#9c40ff",
	startXOffset = 0,
	startYOffset = 0,
	endXOffset = 0,
	endYOffset = 0,
}) => {
	const id = useId();
	const [pathD, setPathD] = useState("");
	const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
	// Picked once: a new random value on every render would restart the sweep.
	const [sweepDuration] = useState(() => duration ?? randomFloatBetween(4, 7));

	// Calculate the gradient coordinates based on the reverse prop
	const gradientCoordinates = reverse
		? { x1: "90%;-10%", x2: "100%;0%" }
		: { x1: "10%;110%", x2: "0%;100%" };

	useEffect(() => {
		const updatePath = () => {
			if (containerRef.current && fromRef.current && toRef.current) {
				const containerRect = containerRef.current.getBoundingClientRect();
				const rectA = fromRef.current.getBoundingClientRect();
				const rectB = toRef.current.getBoundingClientRect();

				const svgWidth = containerRect.width;
				const svgHeight = containerRect.height;
				setSvgDimensions({ width: svgWidth, height: svgHeight });

				const startX =
					// eslint-disable-next-line no-mixed-operators
					rectA.left - containerRect.left + rectA.width / 2 + startXOffset;
				const startY =
					// eslint-disable-next-line no-mixed-operators
					rectA.top - containerRect.top + rectA.height / 2 + startYOffset;
				const endX =
					// eslint-disable-next-line no-mixed-operators
					rectB.left - containerRect.left + rectB.width / 2 + endXOffset;
				const endY =
					// eslint-disable-next-line no-mixed-operators
					rectB.top - containerRect.top + rectB.height / 2 + endYOffset;

				const controlY = startY - curvature;
				const d = `M ${startX},${startY} Q ${
					(startX + endX) / 2
				},${controlY} ${endX},${endY}`;
				setPathD(d);
			}
		};

		// Initialize ResizeObserver
		const resizeObserver = new ResizeObserver((entries) => {
			// For all entries, recalculate the path
			for (const _entry of entries) {
				updatePath();
			}
		});

		// Observe the container element. Its first callback sets the initial
		// path once layout is done, so hydration never forces a reflow.
		if (containerRef.current) {
			resizeObserver.observe(containerRef.current);
		}

		// Clean up the observer on component unmount
		return () => {
			resizeObserver.disconnect();
		};
	}, [
		containerRef,
		fromRef,
		toRef,
		curvature,
		startXOffset,
		startYOffset,
		endXOffset,
		endYOffset,
	]);

	return (
		<svg
			fill="none"
			width={svgDimensions.width}
			height={svgDimensions.height}
			xmlns="http://www.w3.org/2000/svg"
			className={cn(
				"pointer-events-none absolute left-0 top-0 transform-gpu stroke-2",
				className,
			)}
			viewBox={`0 0 ${svgDimensions.width} ${svgDimensions.height}`}
		>
			<path
				d={pathD}
				stroke={pathColor}
				strokeWidth={pathWidth}
				strokeOpacity={pathOpacity}
				strokeLinecap="round"
			/>
			<path
				d={pathD}
				strokeWidth={pathWidth}
				stroke={`url(#${id})`}
				strokeOpacity="1"
				strokeLinecap="round"
			/>
			<defs>
				<linearGradient
					className="transform-gpu"
					id={id}
					gradientUnits="userSpaceOnUse"
					x1="0%"
					x2="0%"
					y1="0%"
					y2="0%"
				>
					{/* SMIL runs the sweep natively, so the page keeps no JS
					    animation loop running for beams that are off screen. */}
					{pathD &&
						(["x1", "x2"] as const).map((attribute) => (
							<animate
								key={attribute}
								attributeName={attribute}
								values={gradientCoordinates[attribute]}
								keyTimes="0;1"
								calcMode="spline"
								keySplines="0.16 1 0.3 1"
								begin={`${delay}s`}
								dur={`${sweepDuration}s`}
								repeatCount="indefinite"
							/>
						))}
					<stop stopColor={gradientStartColor} stopOpacity="0" />
					<stop stopColor={gradientStartColor} />
					<stop offset="32.5%" stopColor={gradientStopColor} />
					<stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
				</linearGradient>
			</defs>
		</svg>
	);
};
