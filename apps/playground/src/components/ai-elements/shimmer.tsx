"use client";

import { motion } from "motion/react";
import { type CSSProperties, type ElementType, type JSX, memo } from "react";

import { cn } from "@/lib/utils";

export interface TextShimmerProps {
	children: string;
	as?: ElementType;
	className?: string;
	duration?: number;
	spread?: number;
}

// motion.create returns a new component type each call, which would remount
// the subtree (and restart the animation) on every render if done inline —
// cache per element type at module level instead.
function createMotionComponent(component: keyof JSX.IntrinsicElements) {
	return motion.create(component);
}

const motionComponentCache = new Map<
	ElementType,
	ReturnType<typeof createMotionComponent>
>();

function getMotionComponent(component: ElementType) {
	let cached = motionComponentCache.get(component);
	if (!cached) {
		cached = createMotionComponent(component as keyof JSX.IntrinsicElements);
		motionComponentCache.set(component, cached);
	}
	return cached;
}

const ShimmerComponent = ({
	children,
	as: Component = "p",
	className,
	duration = 2,
	spread = 2,
}: TextShimmerProps) => {
	const MotionComponent = getMotionComponent(Component);

	const dynamicSpread = (children?.length ?? 0) * spread;

	return (
		<MotionComponent
			animate={{ backgroundPosition: "0% center" }}
			className={cn(
				"relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
				"[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
				className,
			)}
			initial={{ backgroundPosition: "100% center" }}
			style={
				{
					"--spread": `${dynamicSpread}px`,
					backgroundImage:
						"var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
				} as CSSProperties
			}
			transition={{
				repeat: Number.POSITIVE_INFINITY,
				duration,
				ease: "linear",
			}}
		>
			{children}
		</MotionComponent>
	);
};

export const Shimmer = memo(ShimmerComponent);
