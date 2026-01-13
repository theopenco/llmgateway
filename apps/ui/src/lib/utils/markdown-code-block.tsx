"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import React, { useState } from "react";

import type { Language } from "prism-react-renderer";

// Custom dark theme inspired by fumadocs/shiki
const customDarkTheme = {
	...themes.vsDark,
	plain: {
		color: "#d4d4d4",
		backgroundColor: "#1e1e1e",
	},
	styles: [
		...themes.vsDark.styles,
		{
			types: ["comment", "prolog", "doctype", "cdata"],
			style: {
				color: "#6A9955",
				fontStyle: "italic" as const,
			},
		},
		{
			types: ["namespace"],
			style: {
				opacity: 0.7,
			},
		},
		{
			types: ["string", "attr-value"],
			style: {
				color: "#CE9178",
			},
		},
		{
			types: ["punctuation", "operator"],
			style: {
				color: "#d4d4d4",
			},
		},
		{
			types: ["entity", "url", "symbol", "number", "boolean", "constant"],
			style: {
				color: "#B5CEA8",
			},
		},
		{
			types: ["tag", "selector", "attr-name"],
			style: {
				color: "#569CD6",
			},
		},
		{
			types: ["function", "deleted"],
			style: {
				color: "#DCDCAA",
			},
		},
		{
			types: ["keyword", "property"],
			style: {
				color: "#569CD6",
			},
		},
		{
			types: ["class-name"],
			style: {
				color: "#4EC9B0",
			},
		},
		{
			types: ["variable"],
			style: {
				color: "#9CDCFE",
			},
		},
	],
};

// Custom light theme
const customLightTheme = {
	...themes.github,
	plain: {
		color: "#24292e",
		backgroundColor: "#f6f8fa",
	},
};

function normalizeLanguageName(rawLanguageName: string | undefined): Language {
	if (!rawLanguageName) {
		return "text";
	}
	const value = rawLanguageName.toLowerCase();

	const aliasToLanguage: Record<string, Language> = {
		js: "javascript",
		javascript: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		ts: "typescript",
		tsx: "tsx",
		typescript: "typescript",
		jsx: "jsx",
		sh: "bash",
		shell: "bash",
		bash: "bash",
		zsh: "bash",
		yml: "yaml",
		yaml: "yaml",
		json: "json",
		json5: "json",
		html: "markup",
		markup: "markup",
		css: "css",
		scss: "scss",
		md: "markdown",
		markdown: "markdown",
		python: "python",
		py: "python",
		go: "go",
		golang: "go",
		java: "java",
		c: "c",
		cpp: "cpp",
		rust: "rust",
		sql: "sql",
		docker: "docker",
		dockerfile: "docker",
	};

	return aliasToLanguage[value] ?? "text";
}

// Extract filename from className like "language-typescript title='ai-sdk.ts'" or "language-typescript:ai-sdk.ts"
function extractFileInfo(className: string | undefined): {
	language: Language;
	filename?: string;
} {
	if (!className) {
		return { language: "text" };
	}

	let language: Language = "text";
	let filename: string | undefined;

	const parts = className.split(/\s+/g);

	for (const part of parts) {
		// Check for language-xxx or lang-xxx
		const langMatch = part.match(/^(?:language|lang)-([A-Za-z0-9_-]+)/);
		if (langMatch) {
			const langPart = langMatch[1];
			// Check if it includes a filename like "typescript:ai-sdk.ts"
			const colonIndex = langPart.indexOf(":");
			if (colonIndex > 0) {
				language = normalizeLanguageName(langPart.substring(0, colonIndex));
				filename = langPart.substring(colonIndex + 1);
			} else {
				language = normalizeLanguageName(langPart);
			}
			continue;
		}

		// Check for title='filename' or title="filename"
		const titleMatch = part.match(/^title=['"](.+?)['"]$/);
		if (titleMatch) {
			filename = titleMatch[1];
		}
	}

	return { language, filename };
}

// Copy button component
function CopyButton({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="absolute top-3 right-3 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors z-10"
			aria-label="Copy code"
		>
			{copied ? (
				<CheckIcon className="h-4 w-4 text-green-500" />
			) : (
				<CopyIcon className="h-4 w-4 text-muted-foreground" />
			)}
		</button>
	);
}

// Syntax highlighted pre component
export const SyntaxHighlightedPre = ({
	children,
	...props
}: {
	children: React.ReactNode;
	[key: string]: any;
}) => {
	// Extract code content and language from children
	let code = "";
	let language: Language = "text";
	let filename: string | undefined;

	if (children && typeof children === "object" && "props" in children) {
		const childProps = (
			children as { props?: { children?: string; className?: string } }
		).props;
		if (childProps?.children) {
			code = childProps.children.trim();
		}
		if (childProps?.className) {
			const fileInfo = extractFileInfo(childProps.className);
			language = fileInfo.language;
			filename = fileInfo.filename;
		}
	}

	// If no code content, return a simple pre element
	if (!code) {
		return (
			<pre
				className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4"
				{...props}
			>
				{children}
			</pre>
		);
	}

	return (
		<div className="group relative mb-6 overflow-hidden rounded-lg border border-border bg-card">
			{/* Filename tab */}
			{filename && (
				<div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2">
					<svg
						className="h-4 w-4 text-muted-foreground"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
					<span className="text-sm font-medium text-foreground">
						{filename}
					</span>
				</div>
			)}

			{/* Copy button */}
			<CopyButton code={code} />

			{/* Light theme code block */}
			<div className="block dark:hidden">
				<Highlight code={code} language={language} theme={customLightTheme}>
					{({ className, style, tokens, getLineProps, getTokenProps }) => (
						<pre
							className={`${className} p-4 overflow-x-auto text-sm font-mono leading-relaxed`}
							style={{
								...style,
								margin: 0,
								background: "transparent",
							}}
							{...props}
						>
							{tokens.map((line, i) => {
								const lineProps = getLineProps({ line });
								return (
									<div key={i} {...lineProps} className="table-row">
										<span className="table-cell pr-4 text-muted-foreground select-none text-right opacity-50">
											{i + 1}
										</span>
										<span className="table-cell">
											{line.map((token, key) => {
												const tokenProps = getTokenProps({ token });
												return <span key={key} {...tokenProps} />;
											})}
										</span>
									</div>
								);
							})}
						</pre>
					)}
				</Highlight>
			</div>

			{/* Dark theme code block */}
			<div className="hidden dark:block">
				<Highlight code={code} language={language} theme={customDarkTheme}>
					{({ className, style, tokens, getLineProps, getTokenProps }) => (
						<pre
							className={`${className} p-4 overflow-x-auto text-sm font-mono leading-relaxed`}
							style={{
								...style,
								margin: 0,
								background: "transparent",
							}}
							{...props}
						>
							{tokens.map((line, i) => {
								const lineProps = getLineProps({ line });
								return (
									<div key={i} {...lineProps} className="table-row">
										<span className="table-cell pr-4 text-muted-foreground select-none text-right opacity-50">
											{i + 1}
										</span>
										<span className="table-cell">
											{line.map((token, key) => {
												const tokenProps = getTokenProps({ token });
												return <span key={key} {...tokenProps} />;
											})}
										</span>
									</div>
								);
							})}
						</pre>
					)}
				</Highlight>
			</div>
		</div>
	);
};
