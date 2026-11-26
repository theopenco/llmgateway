"use client";

import { LazyMotion, m } from "framer-motion";
import React from "react";

import { cn } from "@/lib/utils";

import type { Variants } from "framer-motion";
import type { ReactNode } from "react";

// LazyMotion + m keep framer-motion's animation runtime out of the initial
// bundle of every marketing page that renders an AnimatedGroup.
const loadMotionFeatures = () =>
	import("@/components/motion-features").then((mod) => mod.default);

type PresetType =
	| "fade"
	| "slide"
	| "scale"
	| "blur"
	| "blur-slide"
	| "zoom"
	| "flip"
	| "bounce"
	| "rotate"
	| "swing";

interface AnimatedGroupProps {
	children: ReactNode;
	className?: string;
	variants?: {
		container?: Variants;
		item?: Variants;
	};
	preset?: PresetType;
}

const defaultContainerVariants: Variants = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: {
			staggerChildren: 0.1,
		},
	},
};

const defaultItemVariants: Variants = {
	hidden: { opacity: 0 },
	visible: { opacity: 1 },
};

const presetVariants: Record<
	PresetType,
	{ container: Variants; item: Variants }
> = {
	fade: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0 },
			visible: { opacity: 1 },
		},
	},
	slide: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, y: 20 },
			visible: { opacity: 1, y: 0 },
		},
	},
	scale: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, scale: 0.8 },
			visible: { opacity: 1, scale: 1 },
		},
	},
	blur: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, filter: "blur(4px)" },
			visible: { opacity: 1, filter: "blur(0px)" },
		},
	},
	"blur-slide": {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, filter: "blur(4px)", y: 20 },
			visible: { opacity: 1, filter: "blur(0px)", y: 0 },
		},
	},
	zoom: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, scale: 0.5 },
			visible: {
				opacity: 1,
				scale: 1,
				transition: { type: "spring", stiffness: 300, damping: 20 },
			},
		},
	},
	flip: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, rotateX: -90 },
			visible: {
				opacity: 1,
				rotateX: 0,
				transition: { type: "spring", stiffness: 300, damping: 20 },
			},
		},
	},
	bounce: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, y: -50 },
			visible: {
				opacity: 1,
				y: 0,
				transition: { type: "spring", stiffness: 400, damping: 10 },
			},
		},
	},
	rotate: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, rotate: -180 },
			visible: {
				opacity: 1,
				rotate: 0,
				transition: { type: "spring", stiffness: 200, damping: 15 },
			},
		},
	},
	swing: {
		container: defaultContainerVariants,
		item: {
			hidden: { opacity: 0, rotate: -10 },
			visible: {
				opacity: 1,
				rotate: 0,
				transition: { type: "spring", stiffness: 300, damping: 8 },
			},
		},
	},
};

function AnimatedGroup({
	children,
	className,
	variants,
	preset,
}: AnimatedGroupProps) {
	const selectedVariants = preset
		? presetVariants[preset]
		: { container: defaultContainerVariants, item: defaultItemVariants };
	const containerVariants = variants?.container ?? selectedVariants.container;
	const itemVariants = variants?.item ?? selectedVariants.item;

	return (
		<LazyMotion features={loadMotionFeatures} strict>
			<m.div
				initial="hidden"
				whileInView="visible"
				viewport={{ once: true, amount: 0.1 }}
				variants={containerVariants}
				className={cn(className)}
			>
				{React.Children.map(children, (child, index) => (
					<m.div key={index} variants={itemVariants}>
						{child}
					</m.div>
				))}
			</m.div>
		</LazyMotion>
	);
}

export { AnimatedGroup };
