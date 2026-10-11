"use client";

import { Check, Copy } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

interface PageViewTrackerProps {
	event: "page_viewed_si_gateway" | "page_viewed_super_intelligence";
}

export function PageViewTracker({ event }: PageViewTrackerProps) {
	const posthog = usePostHog();

	useEffect(() => {
		posthog.capture(event);
	}, [posthog, event]);

	return null;
}

interface CopySnippetProps {
	code: string;
	location: string;
}

export function CopySnippet({ code, location }: CopySnippetProps) {
	const posthog = usePostHog();
	const [copied, setCopied] = useState(false);

	const onCopy = async () => {
		await navigator.clipboard.writeText(code);
		posthog.capture("si_snippet_copied", { location });
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="overflow-hidden rounded-xl border border-border bg-zinc-950 text-left shadow-2xl shadow-sky-500/5">
			<div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
				<div className="flex items-center gap-1.5">
					<span className="h-2.5 w-2.5 rounded-full bg-white/15" />
					<span className="h-2.5 w-2.5 rounded-full bg-white/15" />
					<span className="h-2.5 w-2.5 rounded-full bg-white/15" />
				</div>
				<button
					type="button"
					onClick={onCopy}
					className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
					aria-label="Copy code"
				>
					{copied ? (
						<Check className="h-3.5 w-3.5" />
					) : (
						<Copy className="h-3.5 w-3.5" />
					)}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-100">
				<code>{code}</code>
			</pre>
		</div>
	);
}
