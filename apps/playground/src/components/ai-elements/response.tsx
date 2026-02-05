"use client";

import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

import type { BundledTheme } from "shiki";

type ResponseProps = ComponentProps<typeof Streamdown>;

const shikiTheme: [BundledTheme, BundledTheme] = [
	"github-light",
	"github-dark",
];

export const Response = memo(
	({ className, ...props }: ResponseProps) => (
		<Streamdown
			className={cn(
				"size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
			shikiTheme={shikiTheme}
			{...props}
		/>
	),
	(prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
