"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useId, useState } from "react";

import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Textarea } from "@/lib/components/textarea";

import type { ContextWindowModel } from "./context-window-table";

// The tokenizer ships about 1 MB of BPE ranks; load it only on this tool.
const ContextWindowTable = dynamic(
	() => import("./context-window-table").then((mod) => mod.ContextWindowTable),
	{
		ssr: false,
		loading: () => (
			<p className="text-sm text-muted-foreground">Loading tokenizer…</p>
		),
	},
);

function toCount(value: string): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function ContextWindowClient({
	models,
}: {
	models: ContextWindowModel[];
}) {
	const id = useId();
	const [text, setText] = useState("");
	// Tokenizing a large pasted document blocks the main thread; the deferred
	// value keeps typing responsive while the table catches up.
	const deferredText = useDeferredValue(text);
	const [manualTokens, setManualTokens] = useState("");
	const [outputTokens, setOutputTokens] = useState("4000");
	const [query, setQuery] = useState("");

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor={`${id}-text`}>Your prompt</Label>
				<Textarea
					id={`${id}-text`}
					value={text}
					onChange={(event) => setText(event.target.value)}
					placeholder="Paste the prompt or document you want to send."
					className="min-h-40 font-mono text-sm"
				/>
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<div className="space-y-2">
					<Label htmlFor={`${id}-manual`}>Or enter prompt tokens</Label>
					<Input
						id={`${id}-manual`}
						type="number"
						inputMode="numeric"
						min={0}
						value={manualTokens}
						onChange={(event) => setManualTokens(event.target.value)}
						placeholder="e.g. 120000"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor={`${id}-output`}>Output tokens to reserve</Label>
					<Input
						id={`${id}-output`}
						type="number"
						inputMode="numeric"
						min={0}
						value={outputTokens}
						onChange={(event) => setOutputTokens(event.target.value)}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor={`${id}-query`}>Filter models</Label>
					<Input
						id={`${id}-query`}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Model name"
					/>
				</div>
			</div>
			<ContextWindowTable
				models={models}
				text={deferredText}
				manualTokens={toCount(manualTokens)}
				outputTokens={toCount(outputTokens)}
				query={query}
			/>
		</div>
	);
}
