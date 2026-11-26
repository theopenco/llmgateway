"use client";

import {
	countTokens,
	countWords,
	TOKENIZER_NAME,
} from "@/components/token-cost-calculator/tokenizer";

import { formatNumber } from "@llmgateway/shared/number-format";

export function TokenCounterStats({ text }: { text: string }) {
	const stats = [
		{ label: "Tokens", value: countTokens(text) },
		{ label: "Words", value: countWords(text) },
		{ label: "Characters", value: text.length },
	];
	return (
		<div aria-live="polite">
			<dl className="grid gap-4 sm:grid-cols-3">
				{stats.map((stat) => (
					<div key={stat.label} className="rounded-lg border p-4">
						<dt className="text-sm text-muted-foreground">{stat.label}</dt>
						<dd className="text-3xl font-semibold tabular-nums">
							{formatNumber(stat.value)}
						</dd>
					</div>
				))}
			</dl>
			<p className="mt-3 text-sm text-muted-foreground">
				Counted with the {TOKENIZER_NAME} tokenizer, in your browser. Exact for
				OpenAI models that use it; an estimate for other model families.
			</p>
		</div>
	);
}
