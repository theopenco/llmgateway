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

const TRUSTED_LINK_HOSTS = ["llmgateway.io"];

// Trusted links open directly; everything else goes through Streamdown's
// open/cancel confirmation gate.
const isTrustedLink = (url: string): boolean => {
	try {
		const parsed = new URL(url, window.location.origin);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return false;
		}
		if (parsed.origin === window.location.origin) {
			return true;
		}
		return TRUSTED_LINK_HOSTS.some(
			(host) =>
				parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
		);
	} catch {
		return false;
	}
};

export const Response = memo(
	({ className, isStreaming = false, ...props }: ResponseProps) => (
		<Streamdown
			className={cn(
				"size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-5 [&_ol]:pl-5",
				className,
			)}
			isAnimating={isStreaming}
			plugins={{ code, mermaid, math, cjk }}
			shikiTheme={shikiTheme}
			linkSafety={{ enabled: true, onLinkCheck: isTrustedLink }}
			{...props}
		/>
	),
	(prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
