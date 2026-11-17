"use client";

import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";

export const AGENT_PROMPT = `Use computer use to audit my OpenRouter spend in my own browser.

1. Open https://openrouter.ai/activity. If I am signed out, stop and ask me to sign in. Never type credentials yourself.
2. Set the date range to the last 30 days, or the longest range offered, and export the activity as CSV. Wait for the download to finish and note where the file was saved.
3. Open https://llmgateway.io/savings-audit and load that CSV with the file picker labelled "Drop a usage CSV here, or choose a file". The file is read in the browser and is not uploaded.
4. If the page asks you to choose a column, pick the one that matches: model, input tokens, output tokens, cached tokens, cost.
5. Report what I paid, what the same usage costs on LLM Gateway, the difference, the models with the largest gaps, and any models the audit left out.

Do not change any OpenRouter settings, and do not send the CSV anywhere else.`;

export function AgentPrompt() {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(AGENT_PROMPT);
			setFailed(false);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			setFailed(true);
		}
	};

	return (
		<aside
			aria-labelledby="agent-prompt-heading"
			className="rounded-xl border border-primary/30 bg-primary/5 p-5"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex items-start gap-3">
					<Sparkles
						className="mt-0.5 size-5 shrink-0 text-primary"
						aria-hidden="true"
					/>
					<div>
						<h2 id="agent-prompt-heading" className="font-semibold">
							Let your agent run the audit
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Paste this prompt into an agent with computer use. It exports your
							OpenRouter activity as CSV and loads it here.
						</p>
					</div>
				</div>
				<Button type="button" variant="outline" onClick={() => void copy()}>
					{copied ? (
						<Check className="size-4" aria-hidden="true" />
					) : (
						<Copy className="size-4" aria-hidden="true" />
					)}
					<span aria-live="polite">
						{copied ? "Prompt copied" : "Copy prompt"}
					</span>
				</Button>
			</div>
			<pre className="mt-4 max-h-56 overflow-auto rounded-lg border bg-background p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
				{AGENT_PROMPT}
			</pre>
			{failed ? (
				<p role="alert" className="mt-3 text-sm text-destructive">
					Could not copy. Select the prompt and copy it by hand.
				</p>
			) : null}
		</aside>
	);
}
