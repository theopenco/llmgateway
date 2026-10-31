"use client";

import { ArrowUpRight, Check, Copy, Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import { Fragment, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { CSSProperties, ReactNode } from "react";
import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

const LANGS: BundledLanguage[] = [
	"typescript",
	"python",
	"bash",
	"go",
	"ruby",
	"php",
	"java",
	"rust",
	"toml",
	"json",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	// The JS regex engine handles all ten grammars used here, so the default
	// Oniguruma engine (~450KB of WASM) never has to be downloaded.
	highlighterPromise ??= Promise.all([
		import("shiki"),
		import("shiki/engine/javascript"),
	]).then(([{ createHighlighter }, { createJavaScriptRegexEngine }]) =>
		createHighlighter({
			langs: LANGS,
			themes: ["github-light", "vitesse-dark"],
			engine: createJavaScriptRegexEngine(),
		}),
	);
	return highlighterPromise;
}

function tokenStyle(token: ThemedToken): CSSProperties {
	const fontStyle = token.fontStyle ?? 0;
	return {
		color: token.color,
		fontStyle: fontStyle & 1 ? "italic" : undefined,
		fontWeight: fontStyle & 2 ? 600 : undefined,
	};
}

export type CopyKind = "code" | "agent";

/**
 * The code card from the home page developer section: syntax-highlighted
 * lines, copy, "Copy for agent" and a docs link. Shiki loads only once the
 * card nears the viewport; the plain code renders until then.
 */
export function CodePanel({
	header,
	file,
	endpoint,
	controls,
	lang,
	code,
	agentPrompt,
	docsHref,
	docsLabel,
	onCopy,
	codeClassName = "h-[300px]",
}: {
	header?: ReactNode;
	file: string;
	endpoint?: string;
	controls?: ReactNode;
	lang: BundledLanguage;
	code: string;
	agentPrompt: string;
	docsHref: string;
	docsLabel: string;
	onCopy?: (kind: CopyKind) => void;
	codeClassName?: string;
}) {
	const { resolvedTheme } = useTheme();
	const [copied, setCopied] = useState<CopyKind | null>(null);
	const [highlighted, setHighlighted] = useState<{
		key: string;
		tokens: ThemedToken[][];
	} | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const [nearView, setNearView] = useState(false);

	useEffect(() => {
		const node = rootRef.current;
		if (!node) {
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setNearView(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "600px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const theme = resolvedTheme === "dark" ? "vitesse-dark" : "github-light";
	const key = `${theme}\u0000${lang}\u0000${code}`;
	const tokens = highlighted?.key === key ? highlighted.tokens : null;

	useEffect(() => {
		if (!nearView) {
			return;
		}
		let cancelled = false;
		void getHighlighter()
			.then(async (highlighter) => {
				if (!highlighter.getLoadedLanguages().includes(lang)) {
					await highlighter.loadLanguage(lang);
				}
				if (cancelled) {
					return;
				}
				const result = highlighter.codeToTokens(code, { lang, theme });
				setHighlighted({ key, tokens: result.tokens });
			})
			.catch(() => {
				if (!cancelled) {
					setHighlighted(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [code, lang, theme, key, nearView]);

	const lines = code.split("\n");
	const docsExternal = !docsHref.startsWith("/");

	const copy = async (kind: CopyKind) => {
		try {
			await navigator.clipboard.writeText(kind === "code" ? code : agentPrompt);
			setCopied(kind);
			onCopy?.(kind);
			setTimeout(() => setCopied(null), 1600);
		} catch {
			setCopied(null);
		}
	};

	return (
		<div
			ref={rootRef}
			className="overflow-hidden rounded-xl border border-black/[0.08] bg-[#fafaf9] dark:border-white/[0.08] dark:bg-[#111114]"
		>
			{header}

			<div>
				<div className="flex min-h-11 items-center gap-3 px-3 pt-2 font-mono text-[11px] text-black/60 dark:text-white/55">
					<span className="shrink-0 pl-2">{file}</span>
					{endpoint && (
						<span className="truncate rounded-md border border-black/10 bg-white px-2 py-0.5 text-black/65 dark:border-white/10 dark:bg-white/5 dark:text-white/65">
							{endpoint}
						</span>
					)}
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{controls}
						<button
							type="button"
							onClick={() => void copy("code")}
							aria-label="Copy code"
							className="ml-1 rounded-md border border-black/10 bg-white/80 p-1.5 text-black/50 transition-colors hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-white"
						>
							{copied === "code" ? (
								<Check className="size-3.5" />
							) : (
								<Copy className="size-3.5" />
							)}
						</button>
					</div>
				</div>
				<pre
					className={cn(
						"overflow-auto px-5 pb-5 pt-2 font-mono text-[13px] leading-6",
						codeClassName,
					)}
				>
					<code className="grid grid-cols-[auto_1fr] gap-x-5">
						{lines.map((line, i) => (
							<Fragment key={i}>
								<span
									aria-hidden
									className="select-none text-right text-black/55 dark:text-white/50"
								>
									{i + 1}
								</span>
								<span className="whitespace-pre">
									{tokens?.[i]
										? tokens[i].map((t, j) => (
												<span key={j} style={tokenStyle(t)}>
													{t.content}
												</span>
											))
										: line}
									{line === "" ? " " : null}
								</span>
							</Fragment>
						))}
					</code>
				</pre>
			</div>

			<div className="flex items-center justify-between gap-4 border-t border-black/[0.08] px-4 py-3 text-sm dark:border-white/[0.08]">
				<button
					type="button"
					onClick={() => void copy("agent")}
					className="inline-flex items-center gap-2 font-medium text-black/70 transition-colors hover:text-black dark:text-white/70 dark:hover:text-white"
				>
					{copied === "agent" ? (
						<Check className="size-4" />
					) : (
						<Sparkles className="size-4" />
					)}
					{copied === "agent" ? "Prompt copied" : "Copy for agent"}
				</button>
				<a
					href={docsHref}
					target={docsExternal ? "_blank" : undefined}
					rel={docsExternal ? "noopener noreferrer" : undefined}
					className="inline-flex items-center gap-1 text-black/60 transition-colors hover:text-black dark:text-white/60 dark:hover:text-white"
				>
					{docsLabel}
					<ArrowUpRight className="size-4" />
				</a>
			</div>
		</div>
	);
}
