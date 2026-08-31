"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	createContext,
	memo,
	useCallback,
	use,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { ComponentProps, CSSProperties, HTMLAttributes } from "react";
import type {
	BundledLanguage,
	BundledTheme,
	HighlighterGeneric,
	ThemedToken,
} from "shiki";

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check

const isItalic = (fontStyle: number | undefined) => fontStyle && fontStyle & 1;
// biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check

// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle: number | undefined) => fontStyle && fontStyle & 2;
const isUnderline = (fontStyle: number | undefined) =>
	// biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check
	// oxlint-disable-next-line eslint(no-bitwise)
	fontStyle && fontStyle & 4;

// Transform tokens to include pre-computed keys to avoid noArrayIndexKey lint
interface KeyedToken {
	token: ThemedToken;
	key: string;
}
interface KeyedLine {
	tokens: KeyedToken[];
	key: string;
}

const addKeysToTokens = (lines: ThemedToken[][]): KeyedLine[] =>
	lines.map((line, lineIdx) => ({
		key: `line-${lineIdx}`,
		tokens: line.map((token, tokenIdx) => ({
			key: `line-${lineIdx}-${tokenIdx}`,
			token,
		})),
	}));

// Token rendering component
const TokenSpan = ({ token }: { token: ThemedToken }) => (
	<span
		className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
		style={
			{
				backgroundColor: token.bgColor,
				color: token.color,
				fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
				fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
				textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
				...token.htmlStyle,
			} as CSSProperties
		}
	>
		{token.content}
	</span>
);

// Line rendering component
const LineSpan = ({
	keyedLine,
	showLineNumbers,
}: {
	keyedLine: KeyedLine;
	showLineNumbers: boolean;
}) => (
	<span className={showLineNumbers ? LINE_NUMBER_CLASSES : "block"}>
		{keyedLine.tokens.length === 0
			? "\n"
			: keyedLine.tokens.map(({ token, key }) => (
					<TokenSpan key={key} token={token} />
				))}
	</span>
);

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
	code: string;
	language: BundledLanguage;
	showLineNumbers?: boolean;
};

interface TokenizedCode {
	tokens: ThemedToken[][];
	fg: string;
	bg: string;
}

interface CodeBlockContextType {
	code: string;
}

// Context
const CodeBlockContext = createContext<CodeBlockContextType>({
	code: "",
});

// Highlighter cache (singleton per language)
const highlighterCache = new Map<
	string,
	Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>();

// Token cache, bounded: a long chat renders many code blocks (and streaming
// produces one entry per intermediate snapshot), so evict the least recently
// used entries instead of retaining every token array for the tab's lifetime.
const TOKENS_CACHE_MAX_ENTRIES = 200;
const tokensCache = new Map<string, TokenizedCode>();

function setCachedTokens(key: string, tokens: TokenizedCode) {
	tokensCache.set(key, tokens);
	while (tokensCache.size > TOKENS_CACHE_MAX_ENTRIES) {
		const oldest = tokensCache.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		tokensCache.delete(oldest);
	}
}

function getCachedTokens(key: string): TokenizedCode | undefined {
	const cached = tokensCache.get(key);
	if (cached) {
		// Re-insert so recently used entries sit at the back of the eviction order.
		tokensCache.delete(key);
		tokensCache.set(key, cached);
	}
	return cached;
}

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>();

// Keys with a tokenization already running, so concurrent calls for the same
// code (state initializer + effect + subscription) don't each spawn one.
const inFlightTokenizations = new Set<string>();

// djb2 over the full source: cheap relative to tokenization, and keeps two
// snippets that share length, prefix, and suffix from colliding on one key.
const hashSource = (code: string): number => {
	let hash = 5381;
	for (let i = 0; i < code.length; i++) {
		hash = ((hash << 5) + hash + code.charCodeAt(i)) | 0;
	}
	return hash >>> 0;
};

const getTokensCacheKey = (code: string, language: BundledLanguage) =>
	`${language}:${code.length}:${hashSource(code)}`;

const getHighlighter = (
	language: BundledLanguage,
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
	const cached = highlighterCache.get(language);
	if (cached) {
		return cached;
	}

	// Import shiki lazily so its engine and grammar registry stay out of the
	// chunk until a code block actually renders.
	const highlighterPromise = import("shiki")
		.then(({ createHighlighter }) =>
			createHighlighter({
				langs: [language],
				themes: ["github-light", "github-dark"],
			}),
		)
		.catch((error: unknown) => {
			// Dropping the rejected promise keeps a one-off chunk-load failure
			// (e.g. a deploy rotating hashes under an open tab) from permanently
			// downgrading every later code block to unhighlighted plain text.
			if (highlighterCache.get(language) === highlighterPromise) {
				highlighterCache.delete(language);
			}
			throw error;
		});

	highlighterCache.set(language, highlighterPromise);
	return highlighterPromise;
};

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => ({
	bg: "transparent",
	fg: "inherit",
	tokens: code.split("\n").map((line) =>
		line === ""
			? []
			: [
					{
						color: "inherit",
						content: line,
					} as ThemedToken,
				],
	),
});

// Synchronous highlight with callback for async results
export const highlightCode = (
	code: string,
	language: BundledLanguage,
	// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
	callback?: (result: TokenizedCode) => void,
): TokenizedCode | null => {
	const tokensCacheKey = getTokensCacheKey(code, language);

	// Return cached result if available
	const cached = getCachedTokens(tokensCacheKey);
	if (cached) {
		return cached;
	}

	// Subscribe callback if provided
	if (callback) {
		if (!subscribers.has(tokensCacheKey)) {
			subscribers.set(tokensCacheKey, new Set());
		}
		subscribers.get(tokensCacheKey)?.add(callback);
	}

	// A run for this key is already underway; its completion notifies the
	// subscribers registered above.
	if (inFlightTokenizations.has(tokensCacheKey)) {
		return null;
	}
	inFlightTokenizations.add(tokensCacheKey);

	// Start highlighting in background - fire-and-forget async pattern
	getHighlighter(language)
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
		.then((highlighter) => {
			const availableLangs = highlighter.getLoadedLanguages();
			const langToUse = availableLangs.includes(language) ? language : "text";

			const result = highlighter.codeToTokens(code, {
				lang: langToUse,
				themes: {
					dark: "github-dark",
					light: "github-light",
				},
			});

			const tokenized: TokenizedCode = {
				bg: result.bg ?? "transparent",
				fg: result.fg ?? "inherit",
				tokens: result.tokens,
			};

			// Cache the result
			setCachedTokens(tokensCacheKey, tokenized);
			inFlightTokenizations.delete(tokensCacheKey);

			// Notify all subscribers
			const subs = subscribers.get(tokensCacheKey);
			if (subs) {
				for (const sub of subs as any) {
					sub(tokenized);
				}
				subscribers.delete(tokensCacheKey);
			}
		})
		// oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
		.catch((error) => {
			console.error("Failed to highlight code:", error);
			inFlightTokenizations.delete(tokensCacheKey);
			subscribers.delete(tokensCacheKey);
		});

	return null;
};

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
	"block",
	"before:content-[counter(line)]",
	"before:inline-block",
	"before:[counter-increment:line]",
	"before:w-8",
	"before:mr-4",
	"before:text-right",
	"before:text-muted-foreground/50",
	"before:font-mono",
	"before:select-none",
);

const CodeBlockBody = memo(
	({
		tokenized,
		showLineNumbers,
		className,
	}: {
		tokenized: TokenizedCode;
		showLineNumbers: boolean;
		className?: string;
	}) => {
		const preStyle = useMemo(
			() => ({
				backgroundColor: tokenized.bg,
				color: tokenized.fg,
			}),
			[tokenized.bg, tokenized.fg],
		);

		const keyedLines = useMemo(
			() => addKeysToTokens(tokenized.tokens),
			[tokenized.tokens],
		);

		return (
			<pre
				className={cn(
					"dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)! m-0 p-4 text-sm",
					className,
				)}
				style={preStyle}
			>
				<code
					className={cn(
						"font-mono text-sm",
						showLineNumbers &&
							"[counter-increment:line_0] [counter-reset:line]",
					)}
				>
					{keyedLines.map((keyedLine) => (
						<LineSpan
							key={keyedLine.key}
							keyedLine={keyedLine}
							showLineNumbers={showLineNumbers}
						/>
					))}
				</code>
			</pre>
		);
	},
	(prevProps, nextProps) =>
		prevProps.tokenized === nextProps.tokenized &&
		prevProps.showLineNumbers === nextProps.showLineNumbers &&
		prevProps.className === nextProps.className,
);

CodeBlockBody.displayName = "CodeBlockBody";

export const CodeBlockContainer = ({
	className,
	language,
	style,
	...props
}: HTMLAttributes<HTMLDivElement> & { language: string }) => (
	<div
		className={cn(
			"group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
			className,
		)}
		data-language={language}
		style={{
			containIntrinsicSize: "auto 200px",
			contentVisibility: "auto",
			...style,
		}}
		{...props}
	/>
);

export const CodeBlockHeader = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex items-center justify-between border-b bg-muted/80 px-3 py-2 text-muted-foreground text-xs",
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

export const CodeBlockTitle = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex items-center gap-2", className)} {...props}>
		{children}
	</div>
);

export const CodeBlockFilename = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>) => (
	<span className={cn("font-mono", className)} {...props}>
		{children}
	</span>
);

export const CodeBlockActions = ({
	children,
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("-my-1 -mr-1 flex items-center gap-2", className)}
		{...props}
	>
		{children}
	</div>
);

export const CodeBlockContent = ({
	code,
	language,
	showLineNumbers = false,
}: {
	code: string;
	language: BundledLanguage;
	showLineNumbers?: boolean;
}) => {
	// Memoized raw tokens for immediate display
	const rawTokens = useMemo(() => createRawTokens(code), [code]);

	// Try to get cached result synchronously, otherwise use raw tokens
	const [tokenized, setTokenized] = useState<TokenizedCode>(
		() => highlightCode(code, language) ?? rawTokens,
	);

	useEffect(() => {
		let cancelled = false;

		// Show the cached tokens (or raw code, not stale tokens) immediately and
		// subscribe for the async highlighting result in a single call.
		setTokenized(
			highlightCode(code, language, (result) => {
				if (!cancelled) {
					setTokenized(result);
				}
			}) ?? rawTokens,
		);

		return () => {
			cancelled = true;
		};
	}, [code, language, rawTokens]);

	return (
		<div className="relative overflow-auto">
			<CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
		</div>
	);
};

export const CodeBlock = ({
	code,
	language,
	showLineNumbers = false,
	className,
	children,
	...props
}: CodeBlockProps) => {
	const contextValue = useMemo(() => ({ code }), [code]);

	return (
		<CodeBlockContext value={contextValue}>
			<CodeBlockContainer className={className} language={language} {...props}>
				{children}
				<CodeBlockContent
					code={code}
					language={language}
					showLineNumbers={showLineNumbers}
				/>
			</CodeBlockContainer>
		</CodeBlockContext>
	);
};

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
	onCopy?: () => void;
	onError?: (error: Error) => void;
	timeout?: number;
};

export const CodeBlockCopyButton = ({
	onCopy,
	onError,
	timeout = 2000,
	children,
	className,
	...props
}: CodeBlockCopyButtonProps) => {
	const [isCopied, setIsCopied] = useState(false);
	const timeoutRef = useRef<number>(0);
	const { code } = use(CodeBlockContext);
	const reduceMotion = useReducedMotion();

	const copyToClipboard = useCallback(async () => {
		if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
			onError?.(new Error("Clipboard API not available"));
			return;
		}

		try {
			if (!isCopied) {
				await navigator.clipboard.writeText(code);
				setIsCopied(true);
				onCopy?.();
				timeoutRef.current = window.setTimeout(
					() => setIsCopied(false),
					timeout,
				);
			}
		} catch (error) {
			onError?.(error as Error);
		}
	}, [code, onCopy, onError, timeout, isCopied]);

	useEffect(
		() => () => {
			window.clearTimeout(timeoutRef.current);
		},
		[],
	);

	return (
		<Button
			className={cn("shrink-0", className)}
			onClick={copyToClipboard}
			size="icon"
			variant="ghost"
			{...props}
		>
			{children ?? (
				<span className="relative flex size-4 items-center justify-center">
					<AnimatePresence initial={false}>
						<motion.span
							key={isCopied ? "check" : "copy"}
							initial={
								reduceMotion
									? { opacity: 0 }
									: { opacity: 0, transform: "scale(0.45) rotate(-18deg)" }
							}
							animate={
								reduceMotion
									? { opacity: 1 }
									: { opacity: 1, transform: "scale(1) rotate(0deg)" }
							}
							exit={
								reduceMotion
									? { opacity: 0 }
									: { opacity: 0, transform: "scale(0.45) rotate(18deg)" }
							}
							transition={{ duration: 0.16, ease: "easeOut" }}
							className="absolute inset-0 flex items-center justify-center"
						>
							{isCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
						</motion.span>
					</AnimatePresence>
				</span>
			)}
		</Button>
	);
};

export type CodeBlockLanguageSelectorProps = ComponentProps<typeof Select>;

export const CodeBlockLanguageSelector = (
	props: CodeBlockLanguageSelectorProps,
) => <Select {...props} />;

export type CodeBlockLanguageSelectorTriggerProps = ComponentProps<
	typeof SelectTrigger
>;

export const CodeBlockLanguageSelectorTrigger = ({
	className,
	...props
}: CodeBlockLanguageSelectorTriggerProps) => (
	<SelectTrigger
		className={cn(
			"h-7 border-none bg-transparent px-2 text-xs shadow-none",
			className,
		)}
		size="sm"
		{...props}
	/>
);

export type CodeBlockLanguageSelectorValueProps = ComponentProps<
	typeof SelectValue
>;

export const CodeBlockLanguageSelectorValue = (
	props: CodeBlockLanguageSelectorValueProps,
) => <SelectValue {...props} />;

export type CodeBlockLanguageSelectorContentProps = ComponentProps<
	typeof SelectContent
>;

export const CodeBlockLanguageSelectorContent = ({
	align = "end",
	...props
}: CodeBlockLanguageSelectorContentProps) => (
	<SelectContent align={align} {...props} />
);

export type CodeBlockLanguageSelectorItemProps = ComponentProps<
	typeof SelectItem
>;

export const CodeBlockLanguageSelectorItem = (
	props: CodeBlockLanguageSelectorItemProps,
) => <SelectItem {...props} />;
