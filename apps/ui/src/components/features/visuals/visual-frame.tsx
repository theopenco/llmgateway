import { cn } from "@/lib/utils";

import s from "./visuals.module.css";

import type { CSSProperties, ReactNode } from "react";

export function stagger(i: number): CSSProperties {
	return { "--i": i } as CSSProperties;
}

export function VisualFrame({
	title,
	children,
	className,
}: {
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-[0_0_48px_rgba(0,0,0,0.35)]",
				className,
			)}
		>
			<div
				className={cn(
					s.dotGrid,
					"pointer-events-none absolute inset-0 opacity-60",
				)}
			/>
			<div className={cn(s.glow, "pointer-events-none absolute inset-0")} />
			<div className="relative flex items-center gap-1.5 border-b border-border/70 bg-background/70 px-4 py-2.5 backdrop-blur">
				<span className="size-2.5 rounded-full bg-muted-foreground/25" />
				<span className="size-2.5 rounded-full bg-muted-foreground/25" />
				<span className="size-2.5 rounded-full bg-muted-foreground/25" />
				<span className="ml-2 truncate font-mono text-xs text-muted-foreground">
					{title}
				</span>
			</div>
			<div className="relative p-5 sm:p-6">{children}</div>
		</div>
	);
}

export function Chip({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<span
			style={style}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 font-mono text-[11px] text-muted-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}
