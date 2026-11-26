"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useId, useState } from "react";

import { Label } from "@/lib/components/label";
import { Textarea } from "@/lib/components/textarea";

// The tokenizer ships about 1 MB of BPE ranks; load it only on this tool.
const TokenCounterStats = dynamic(
	() => import("./token-counter-stats").then((mod) => mod.TokenCounterStats),
	{
		ssr: false,
		loading: () => (
			<p className="text-sm text-muted-foreground">Loading tokenizer…</p>
		),
	},
);

export function TokenCounterClient() {
	const id = useId();
	const [text, setText] = useState("");
	// Tokenizing a large pasted document blocks the main thread; the deferred
	// value keeps typing responsive while the count catches up.
	const deferredText = useDeferredValue(text);
	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor={id}>Text to count</Label>
				<Textarea
					id={id}
					value={text}
					onChange={(event) => setText(event.target.value)}
					placeholder="Paste a prompt, document, or code."
					className="min-h-56 font-mono text-sm"
				/>
			</div>
			<TokenCounterStats text={deferredText} />
		</div>
	);
}
