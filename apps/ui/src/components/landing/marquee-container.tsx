"use client";

import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

interface MarqueeContainerProps {
	children: ReactNode;
	reverse?: boolean;
	className?: string;
}

export function MarqueeContainer({
	children,
	reverse = false,
	className,
}: MarqueeContainerProps) {
	return (
		<div
			className={cn(
				"group flex gap-6 overflow-hidden",
				"[mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]",
				className,
			)}
		>
			<div
				className={cn(
					"flex shrink-0 gap-6 animate-marquee",
					reverse && "[animation-direction:reverse]",
					"group-hover:[animation-play-state:paused]",
				)}
				style={{ ["--duration" as string]: "40s", ["--gap" as string]: "24px" }}
			>
				{children}
			</div>
			<div
				className={cn(
					"flex shrink-0 gap-6 animate-marquee",
					reverse && "[animation-direction:reverse]",
					"group-hover:[animation-play-state:paused]",
				)}
				aria-hidden="true"
				style={{ ["--duration" as string]: "40s", ["--gap" as string]: "24px" }}
			>
				{children}
			</div>
		</div>
	);
}
