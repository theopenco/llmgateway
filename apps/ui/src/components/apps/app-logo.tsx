import { cn } from "@/lib/utils";

import type React from "react";

export function AppLogo({
	Icon,
	name,
	size = "md",
}: {
	Icon?: React.FC<React.SVGProps<SVGSVGElement>>;
	name: string;
	size?: "sm" | "md" | "lg";
}) {
	const dim =
		size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-12 w-12";
	const iconDim =
		size === "lg" ? "h-8 w-8" : size === "sm" ? "h-5 w-5" : "h-7 w-7";
	if (Icon) {
		return (
			<div
				className={cn(
					"flex shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted text-foreground",
					dim,
				)}
				aria-hidden
			>
				<Icon className={iconDim} aria-hidden focusable={false} />
			</div>
		);
	}
	const initial = name
		.replace(/^https?:\/\//, "")
		.charAt(0)
		.toUpperCase();
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted font-display font-semibold text-muted-foreground",
				dim,
				size === "lg" ? "text-xl" : "text-base",
			)}
			aria-hidden
		>
			{initial || "?"}
		</div>
	);
}
