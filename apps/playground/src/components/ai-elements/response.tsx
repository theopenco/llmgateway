"use client";

import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import "katex/dist/katex.min.css";
import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

import type { BundledTheme } from "shiki";

type ResponseProps = ComponentProps<typeof Streamdown> & {
	isStreaming?: boolean;
};

const shikiTheme: [BundledTheme, BundledTheme] = [
	"github-light",
	"github-dark",
];

const code = createCodePlugin({
	themes: ["github-light", "github-dark"],
});

export const Response = memo(
	({ className, isStreaming = false, ...props }: ResponseProps) => (
		<Streamdown
			className={cn(
				"size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
			isAnimating={isStreaming}
			plugins={{ code, mermaid, math, cjk }}
			shikiTheme={shikiTheme}
			{...props}
		/>
	),
	(prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
