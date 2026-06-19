"use client";

import {
	ArrowRight,
	Check,
	Copy,
	Hash,
	Linkedin,
	Sparkles,
	Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import { Textarea } from "@/lib/components/textarea";
import { XIcon } from "@/lib/icons/XIcon";

import {
	computeRowCost,
	formatInt,
	formatTokenCount,
	formatUsd,
	getPopularModels,
	getProviderName,
} from "./calc-utils";
import { countTokens, countWords, TOKENIZER_NAME } from "./tokenizer";

import type { ModelDefinition } from "@llmgateway/models";

// ─── Static config ───────────────────────────────────────────────────────────

const POPULAR_MODELS = getPopularModels();

// Tokenizing megabytes of text on every keystroke would jank the UI; this is far
// larger than any realistic prompt and only guards against pathological pastes.
const MAX_TOKENIZE_CHARS = 200_000;

const OUTPUT_PRESETS = [
	{ label: "Short reply", value: 150 },
	{ label: "Standard answer", value: 600 },
	{ label: "Long response", value: 2_000 },
	{ label: "Essay / report", value: 5_000 },
];

const REQUEST_PRESETS = [
	{ label: "1 call", value: 1 },
	{ label: "1K calls", value: 1_000 },
	{ label: "100K calls", value: 100_000 },
	{ label: "1M calls", value: 1_000_000 },
];

const SAMPLES: { label: string; text: string }[] = [
	{
		label: "Support prompt",
		text: `You are a friendly customer support assistant for an e-commerce store. A customer writes: "Hi, I ordered a pair of running shoes (order #48217) five days ago and the tracking hasn't updated since it left the warehouse. I need them before this weekend for a race. Can you tell me where my package is and whether it'll arrive in time? If not, what are my options?" Respond warmly, acknowledge the urgency, explain the likely status, and offer concrete next steps.`,
	},
	{
		label: "Code review",
		text: `Review this function for correctness, performance, and edge cases, then suggest improvements:

function dedupeUsers(users) {
  const seen = {};
  const result = [];
  for (let i = 0; i < users.length; i++) {
    const key = users[i].email.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      result.push(users[i]);
    }
  }
  return result;
}

Consider null emails, unicode normalization, and whether a Map would be clearer.`,
	},
	{
		label: "JSON payload",
		text: `Extract the structured fields from this support ticket and return strict JSON:

{
  "ticket_id": "T-90412",
  "customer": { "name": "Dana Whitfield", "tier": "pro", "region": "EU" },
  "subject": "Invoice discrepancy on March billing",
  "body": "We were charged for 12 seats but our plan covers 10. Please review and refund the difference. This is the second month in a row.",
  "attachments": ["invoice_march.pdf", "plan_contract.pdf"],
  "priority": "high"
}

Return: { sentiment, intent, refund_requested (bool), seats_billed, seats_allowed }`,
	},
];

// ─── URL state ───────────────────────────────────────────────────────────────

function readSeedFromUrl(): {
	inputTokens: number;
	outputTokens: number;
	requests: number;
} {
	const fallback = { inputTokens: 0, outputTokens: 600, requests: 1 };
	if (typeof window === "undefined") {
		return fallback;
	}
	const params = new URLSearchParams(window.location.search);
	const it = Number(params.get("it"));
	const ot = Number(params.get("ot"));
	const n = Number(params.get("n"));
	return {
		inputTokens: Number.isFinite(it) && it > 0 ? Math.round(it) : 0,
		outputTokens:
			Number.isFinite(ot) && ot > 0 ? Math.round(ot) : fallback.outputTokens,
		requests: Number.isFinite(n) && n > 0 ? Math.round(n) : fallback.requests,
	};
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TokenizerPanel() {
	const seed = useRef(readSeedFromUrl());
	const [text, setText] = useState("");
	const [outputTokens, setOutputTokens] = useState(seed.current.outputTokens);
	const [requests, setRequests] = useState(seed.current.requests);
	const [copied, setCopied] = useState(false);

	const liveTokens = useMemo(() => {
		if (!text) {
			return 0;
		}
		return countTokens(text.slice(0, MAX_TOKENIZE_CHARS));
	}, [text]);

	const truncated = text.length > MAX_TOKENIZE_CHARS;
	const charCount = text.length;
	const wordCount = useMemo(() => countWords(text), [text]);

	// When there's pasted text we count it live; otherwise fall back to the seed
	// from a shared link so the comparison still renders.
	const inputTokens = text.trim() ? liveTokens : seed.current.inputTokens;

	// Keep the URL in sync so the comparison is shareable / bookmarkable.
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const params = new URLSearchParams(window.location.search);
		if (inputTokens > 0) {
			params.set("it", String(inputTokens));
		} else {
			params.delete("it");
		}
		params.set("ot", String(outputTokens));
		params.set("n", String(requests));
		const next = `${window.location.pathname}?${params.toString()}`;
		window.history.replaceState(null, "", next);
	}, [inputTokens, outputTokens, requests]);

	const rows = useMemo(() => {
		const computed = POPULAR_MODELS.map((model: ModelDefinition) => {
			const cost = computeRowCost(model, inputTokens, outputTokens);
			const perRequest = cost.gatewayCost;
			return {
				model,
				cheapestMapping: cost.cheapestMapping,
				unpriced: cost.unpriced,
				perRequest,
				total: perRequest * requests,
				hasReasoning: model.providers.some((p) => p.reasoning),
			};
		}).filter((r) => !r.unpriced);
		computed.sort((a, b) => a.perRequest - b.perRequest);
		return computed;
	}, [inputTokens, outputTokens, requests]);

	const cheapest = rows[0];
	const priciest = rows[rows.length - 1];
	const spread = cheapest && priciest ? priciest.total - cheapest.total : 0;
	const spreadPct =
		cheapest && priciest && priciest.total > 0
			? Math.round((spread / priciest.total) * 100)
			: 0;

	const hasInput = inputTokens > 0;

	const shareText = useMemo(() => {
		if (!hasInput || !cheapest || !priciest) {
			return "";
		}
		const lines = [
			`My ${formatInt(inputTokens)}-token prompt priced across the top LLMs:`,
			"",
			`Cheapest: ${cheapest.model.name ?? cheapest.model.id} — ${formatUsd(cheapest.total)}`,
			`Priciest: ${priciest.model.name ?? priciest.model.id} — ${formatUsd(priciest.total)}`,
			"",
			`That's a ${spreadPct}% swing for the exact same ${formatInt(requests)} request${requests === 1 ? "" : "s"}.`,
			"",
			"Count yours free with @llmgateway:",
		];
		return lines.join("\n");
	}, [hasInput, cheapest, priciest, inputTokens, requests, spreadPct]);

	const pageUrl =
		typeof window !== "undefined"
			? window.location.href
			: "https://llmgateway.io/token-cost-calculator";

	const handleCopy = async () => {
		await navigator.clipboard.writeText(`${shareText}\n${pageUrl}`);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const xShareUrl = `https://x.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(shareText)}`;
	const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;

	return (
		<div className="space-y-6">
			{/* Input card */}
			<Card className="p-5 sm:p-6 border-border bg-card/50">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<label htmlFor="tokenizer-input" className="text-sm font-semibold">
						Paste your prompt, document, or code
					</label>
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-[11px] text-muted-foreground mr-1">Try:</span>
						{SAMPLES.map((sample) => (
							<button
								key={sample.label}
								type="button"
								onClick={() => setText(sample.text)}
								className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:border-blue-500/40 hover:text-foreground transition-colors"
							>
								{sample.label}
							</button>
						))}
						{text && (
							<button
								type="button"
								onClick={() => setText("")}
								className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:border-red-500/40 hover:text-red-500 transition-colors"
							>
								Clear
							</button>
						)}
					</div>
				</div>

				<Textarea
					id="tokenizer-input"
					value={text}
					onChange={(e) => setText(e.target.value)}
					placeholder="Type or paste text here to count its exact tokens and see what it costs on every major model…"
					className="mt-3 min-h-[160px] font-mono text-sm leading-relaxed resize-y"
					spellCheck={false}
				/>

				{/* Live stats */}
				<div className="mt-4 grid grid-cols-3 gap-3">
					<StatTile
						label="Tokens"
						value={formatInt(inputTokens)}
						highlight
						icon={<Hash className="h-3.5 w-3.5" />}
					/>
					<StatTile label="Characters" value={formatInt(charCount)} />
					<StatTile label="Words" value={formatInt(wordCount)} />
				</div>
				<p className="mt-3 text-[11px] text-muted-foreground">
					Counted in your browser with the {TOKENIZER_NAME} tokenizer — nothing
					is uploaded.
					{truncated
						? " Showing the first 200K characters."
						: " Other model families tokenize within roughly ±15% of this count."}
				</p>
			</Card>

			{/* Controls */}
			<div className="grid gap-4 sm:grid-cols-2">
				<Card className="p-5 border-border bg-card/50">
					<p className="text-sm font-medium mb-3">Expected response length</p>
					<div className="flex flex-wrap gap-1.5">
						{OUTPUT_PRESETS.map((preset) => (
							<button
								key={preset.value}
								type="button"
								onClick={() => setOutputTokens(preset.value)}
								className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
									outputTokens === preset.value
										? "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400"
										: "border-border text-muted-foreground hover:border-blue-500/30 hover:text-foreground"
								}`}
							>
								{preset.label}
								<span className="ml-1 opacity-60">
									{formatTokenCount(preset.value)}
								</span>
							</button>
						))}
					</div>
					<p className="mt-3 text-[11px] text-muted-foreground">
						Output tokens are billed too and usually cost more than input. Pick
						the size of answer you expect.
					</p>
				</Card>

				<Card className="p-5 border-border bg-card/50">
					<p className="text-sm font-medium mb-3">How many requests?</p>
					<div className="flex flex-wrap gap-1.5">
						{REQUEST_PRESETS.map((preset) => (
							<button
								key={preset.value}
								type="button"
								onClick={() => setRequests(preset.value)}
								className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
									requests === preset.value
										? "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400"
										: "border-border text-muted-foreground hover:border-blue-500/30 hover:text-foreground"
								}`}
							>
								{preset.label}
							</button>
						))}
					</div>
					<p className="mt-3 text-[11px] text-muted-foreground">
						Multiply this prompt across your real volume to see the total bill.
					</p>
				</Card>
			</div>

			{/* Results */}
			{!hasInput ? (
				<Card className="p-8 text-center border-dashed border-border bg-card/30">
					<Sparkles className="mx-auto h-6 w-6 text-blue-500/70" />
					<p className="mt-3 text-sm text-muted-foreground">
						Paste some text above (or tap a sample) to count its tokens and rank
						every major model by what it would cost you.
					</p>
				</Card>
			) : (
				<>
					{/* Headline comparison */}
					{cheapest && priciest && spread > 0 && (
						<Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-500/10 to-blue-500/5 p-6 sm:p-8 text-center">
							<p className="text-sm text-muted-foreground">
								The same {formatInt(inputTokens)}-token prompt
								{requests > 1 ? `, ×${formatInt(requests)} requests,` : ""}{" "}
								ranges from
							</p>
							<div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
								<span className="text-3xl sm:text-4xl font-bold text-green-600 dark:text-green-400">
									{formatUsd(cheapest.total)}
								</span>
								<span className="text-muted-foreground">to</span>
								<span className="text-3xl sm:text-4xl font-bold">
									{formatUsd(priciest.total)}
								</span>
							</div>
							<p className="mt-3 text-sm text-muted-foreground">
								Picking{" "}
								<span className="font-medium text-foreground">
									{cheapest.model.name ?? cheapest.model.id}
								</span>{" "}
								over{" "}
								<span className="font-medium text-foreground">
									{priciest.model.name ?? priciest.model.id}
								</span>{" "}
								saves{" "}
								<span className="font-semibold text-green-600 dark:text-green-400">
									{formatUsd(spread)} ({spreadPct}%)
								</span>{" "}
								— same prompt, same task.
							</p>
						</Card>
					)}

					{/* Ranked table */}
					<Card className="border-border overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b border-border bg-muted/50">
										<th className="text-left py-3 px-4 font-medium text-muted-foreground">
											Model
										</th>
										<th className="text-right py-3 px-4 font-medium text-muted-foreground">
											Cost / request
										</th>
										<th className="text-right py-3 px-4 font-medium text-muted-foreground">
											{requests > 1
												? `Total · ${formatInt(requests)} calls`
												: "Total"}
										</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((r, i) => (
										<tr
											key={r.model.id}
											className={`border-b border-border last:border-0 ${
												i === 0 ? "bg-green-500/5" : ""
											}`}
										>
											<td className="py-3 px-4">
												<div className="flex items-center gap-2">
													{i === 0 && (
														<Trophy className="h-3.5 w-3.5 text-green-500 shrink-0" />
													)}
													<div>
														<p className="font-medium leading-tight">
															{r.model.name ?? r.model.id}
															{r.hasReasoning && (
																<span className="ml-1.5 align-middle text-[10px] text-amber-600 dark:text-amber-400">
																	reasoning
																</span>
															)}
														</p>
														<p className="text-xs text-muted-foreground">
															{r.cheapestMapping
																? `via ${getProviderName(r.cheapestMapping.providerId)}`
																: ""}
														</p>
													</div>
												</div>
											</td>
											<td className="py-3 px-4 text-right font-mono text-xs">
												{formatUsd(r.perRequest)}
											</td>
											<td
												className={`py-3 px-4 text-right font-mono ${
													i === 0
														? "text-green-600 dark:text-green-400 font-semibold"
														: ""
												}`}
											>
												{formatUsd(r.total)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Card>

					<p className="text-[11px] text-muted-foreground px-1">
						Costs use each model&apos;s cheapest active provider on LLM Gateway
						(no platform markup). Reasoning models also bill hidden thinking
						tokens, so their real output cost runs higher than shown.
					</p>

					{/* Share */}
					<div className="flex flex-col gap-4 rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-blue-600/5 p-5 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p className="text-sm font-semibold">Share this comparison</p>
							<p className="text-xs text-muted-foreground">
								The link reopens with your exact token count and costs.
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								onClick={handleCopy}
								variant={copied ? "outline" : "default"}
								size="sm"
								className="gap-2"
							>
								{copied ? (
									<Check className="h-4 w-4 text-green-500" />
								) : (
									<Copy className="h-4 w-4" />
								)}
								{copied ? "Copied!" : "Copy link"}
							</Button>
							<Button variant="outline" size="sm" className="gap-2" asChild>
								<a href={xShareUrl} target="_blank" rel="noopener noreferrer">
									<XIcon className="h-4 w-4" />
									Post on X
								</a>
							</Button>
							<Button variant="outline" size="sm" className="gap-2" asChild>
								<a
									href={linkedinShareUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									<Linkedin className="h-4 w-4" />
									LinkedIn
								</a>
							</Button>
						</div>
					</div>

					{/* CTA */}
					<Card className="p-6 sm:p-8 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-blue-600/5 text-center">
						<h3 className="text-xl sm:text-2xl font-bold mb-2 text-balance">
							Pay the cheapest price automatically
						</h3>
						<p className="text-sm text-muted-foreground mb-5 text-balance leading-relaxed max-w-xl mx-auto">
							LLM Gateway routes every request to the lowest-priced provider for
							your model through one OpenAI-compatible API — no markup, no code
							changes.
						</p>
						<Button size="lg" asChild>
							<Link href="/signup">
								Start free
								<ArrowRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
					</Card>
				</>
			)}
		</div>
	);
}

function StatTile({
	label,
	value,
	highlight,
	icon,
}: {
	label: string;
	value: string;
	highlight?: boolean;
	icon?: React.ReactNode;
}) {
	return (
		<div
			className={`rounded-lg border p-3 text-center ${
				highlight
					? "border-blue-500/40 bg-blue-500/5"
					: "border-border bg-card/40"
			}`}
		>
			<p
				className={`text-2xl font-bold tabular-nums ${
					highlight ? "text-blue-600 dark:text-blue-400" : ""
				}`}
			>
				{value}
			</p>
			<p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
				{icon}
				{label}
			</p>
		</div>
	);
}
