"use client";

import { AlertCircle, Check, Code2, Copy, Scale } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	DECISION_QUESTION_TYPE_LABELS,
	decisionAnswerHeadline,
	decisionRequestSnippet,
	decisionScenarios,
	formatProbability,
	formatRunTimestamp,
	topProbability,
} from "@/lib/decisions";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

import type {
	DecisionAnswer,
	DecisionGalleryItem,
	DecisionModelResult,
	DecisionProbability,
	DecisionQuestion,
	DecisionScenario,
} from "@/lib/decisions";

interface DecisionsGalleryProps {
	items: DecisionGalleryItem[];
	comparisonMode: boolean;
	onScenarioClick?: (scenario: DecisionScenario) => void;
}

function ProbabilityBar({
	label,
	description,
	probability,
	highlighted,
}: {
	label: string;
	description?: string;
	probability: number;
	highlighted: boolean;
}) {
	const width = `${Math.round(Math.max(0, Math.min(1, probability)) * 100)}%`;
	return (
		<div className="space-y-1">
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span
					className={cn(
						"min-w-0 truncate",
						highlighted ? "font-medium" : "text-muted-foreground",
					)}
					title={description}
				>
					{label}
				</span>
				<span
					className={cn(
						"shrink-0 font-mono tabular-nums",
						highlighted ? "font-medium" : "text-muted-foreground",
					)}
				>
					{formatProbability(probability)}
				</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<motion.div
					className={cn(
						"h-full rounded-full",
						highlighted ? "bg-primary" : "bg-muted-foreground/40",
					)}
					initial={{ width: 0 }}
					animate={{ width }}
					transition={{ duration: 0.35, ease: "easeOut" }}
				/>
			</div>
		</div>
	);
}

function PredicateAnswer({ answer }: { answer: DecisionAnswer }) {
	const probability = answer.probability ?? 0;
	return (
		<div className="space-y-2">
			<ProbabilityBar label="Yes" probability={probability} highlighted />
			<ProbabilityBar
				label="No"
				probability={1 - probability}
				highlighted={false}
			/>
		</div>
	);
}

function ChoiceAnswer({
	answer,
	question,
}: {
	answer: DecisionAnswer;
	question?: DecisionQuestion;
}) {
	const choices = question?.type === "choice" ? question.choices : [];
	const rows: DecisionProbability[] = answer.probabilities?.length
		? answer.probabilities
		: choices.map((choice) => ({
				value: choice.value,
				probability: choice.value === answer.choice ? 1 : 0,
			}));
	const sorted = [...rows].sort((a, b) => b.probability - a.probability);
	return (
		<div className="space-y-2">
			{sorted.map((row) => {
				const value = String(row.value);
				return (
					<ProbabilityBar
						key={value}
						label={row.label ?? value}
						description={
							choices.find((choice) => choice.value === value)?.description
						}
						probability={row.probability}
						highlighted={String(answer.choice) === value}
					/>
				);
			})}
		</div>
	);
}

function ScoreAnswer({
	answer,
	question,
}: {
	answer: DecisionAnswer;
	question?: DecisionQuestion;
}) {
	const levels = question?.type === "score" ? question.levels : [];
	const top = topProbability(answer);
	const rows = answer.probabilities?.length
		? answer.probabilities
		: levels.map((level, index) => ({
				value: index,
				label: level.label,
				probability: 0,
			}));
	return (
		<div className="space-y-2">
			{rows.map((row, index) => {
				const levelIndex = typeof row.value === "number" ? row.value : index;
				const label =
					row.label ?? levels[levelIndex]?.label ?? String(row.value);
				return (
					<ProbabilityBar
						key={`${label}-${index}`}
						label={label}
						description={levels[levelIndex]?.description}
						probability={row.probability}
						highlighted={top !== null && top.value === row.value}
					/>
				);
			})}
			{answer.score !== undefined && levels.length > 1 && (
				<p className="text-[11px] text-muted-foreground">
					Weighted score {answer.score.toFixed(2)} of {levels.length - 1}
				</p>
			)}
		</div>
	);
}

function AnswerCard({
	answer,
	question,
	index,
}: {
	answer: DecisionAnswer;
	question?: DecisionQuestion;
	index: number;
}) {
	const type =
		question?.type ?? (answer.type === "refusal" ? null : answer.type);
	const headline = decisionAnswerHeadline(answer, question);
	return (
		<div className="rounded-lg border bg-card p-3 space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<span className="font-mono">
							{answer.name ?? question?.name ?? `q${index + 1}`}
						</span>
						{type && (
							<>
								<span aria-hidden>·</span>
								<span>{DECISION_QUESTION_TYPE_LABELS[type].label}</span>
							</>
						)}
					</div>
					{question?.instructions && (
						<p className="mt-0.5 text-sm leading-snug">
							{question.instructions}
						</p>
					)}
				</div>
				<div className="shrink-0 text-right">
					<div
						className={cn(
							"text-base font-semibold leading-tight",
							answer.type === "refusal" && "text-destructive",
						)}
					>
						{headline}
					</div>
					{answer.confidence !== undefined && (
						<div className="text-[11px] text-muted-foreground">
							{formatProbability(answer.confidence)} confident
						</div>
					)}
				</div>
			</div>
			{answer.type === "predicate" && <PredicateAnswer answer={answer} />}
			{answer.type === "choice" && (
				<ChoiceAnswer answer={answer} question={question} />
			)}
			{answer.type === "score" && (
				<ScoreAnswer answer={answer} question={question} />
			)}
			{answer.type === "refusal" && (
				<p className="text-xs text-muted-foreground">
					The model declined to answer this question. The other answers are
					unaffected.
				</p>
			)}
		</div>
	);
}

function LoadingSkeleton({ count }: { count: number }) {
	return (
		<div className="space-y-3">
			{Array.from({ length: count }).map((_, index) => (
				<Skeleton key={index} className="h-28 rounded-lg" />
			))}
		</div>
	);
}

function ModelResult({
	result,
	item,
	showModelName,
}: {
	result: DecisionModelResult;
	item: DecisionGalleryItem;
	showModelName: boolean;
}) {
	const [showJson, setShowJson] = useState(false);
	const [copied, setCopied] = useState<"request" | "json" | null>(null);

	const copy = async (kind: "request" | "json", text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(kind);
			setTimeout(() => setCopied(null), 1500);
		} catch {
			toast.error("Could not copy to the clipboard");
		}
	};

	const inputTokens = result.usage?.input_tokens;

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				{showModelName && (
					<Badge variant="outline" className="text-xs">
						{result.modelName}
					</Badge>
				)}
				{inputTokens !== undefined && !result.isLoading && (
					<span className="text-[11px] text-muted-foreground">
						{formatNumber(inputTokens)} input tokens
					</span>
				)}
				{!result.isLoading && !result.error && (
					<div className="ml-auto flex items-center gap-1">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs"
									onClick={() =>
										copy(
											"request",
											decisionRequestSnippet(item, result.modelId),
										)
									}
								>
									{copied === "request" ? (
										<Check className="h-3.5 w-3.5" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
									<span className="ml-1">cURL</span>
								</Button>
							</TooltipTrigger>
							<TooltipContent>Copy this run as an API request</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className={cn("h-7 px-2 text-xs", showJson && "bg-muted")}
									aria-pressed={showJson}
									onClick={() => setShowJson((value) => !value)}
								>
									<Code2 className="h-3.5 w-3.5" />
									<span className="ml-1">JSON</span>
								</Button>
							</TooltipTrigger>
							<TooltipContent>Show the raw answers</TooltipContent>
						</Tooltip>
					</div>
				)}
			</div>
			{result.error ? (
				<div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
					<AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
					<p className="text-sm text-destructive">{result.error}</p>
				</div>
			) : result.isLoading ? (
				<LoadingSkeleton count={item.questions.length} />
			) : showJson && result.answers ? (
				<div className="relative">
					<pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
						{JSON.stringify(
							{
								model: result.modelId,
								answers: result.answers,
								usage: result.usage,
							},
							null,
							2,
						)}
					</pre>
					<Button
						variant="secondary"
						size="icon"
						className="absolute right-2 top-2 h-7 w-7"
						aria-label="Copy JSON"
						onClick={() =>
							copy(
								"json",
								JSON.stringify(
									{
										model: result.modelId,
										answers: result.answers,
										usage: result.usage,
									},
									null,
									2,
								),
							)
						}
					>
						{copied === "json" ? (
							<Check className="h-3.5 w-3.5" />
						) : (
							<Copy className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			) : result.answers ? (
				<div className="grid gap-3">
					{result.answers.map((answer, index) => (
						<AnswerCard
							key={`${answer.name ?? index}-${index}`}
							answer={answer}
							question={item.questions[index]}
							index={index}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function RunHeader({ item }: { item: DecisionGalleryItem }) {
	const [expanded, setExpanded] = useState(false);
	const text = item.prompt.trim();
	const isLong = text.length > 280;
	const title = item.title?.trim();
	return (
		<div className="space-y-2">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					{title && <h3 className="mb-1 text-sm font-medium">{title}</h3>}
					{text ? (
						<p
							className={cn(
								"whitespace-pre-wrap text-sm text-muted-foreground",
								!expanded && isLong && "line-clamp-3",
							)}
						>
							{text}
						</p>
					) : (
						<p className="text-sm italic text-muted-foreground">Images only</p>
					)}
					{isLong && (
						<button
							type="button"
							className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
							onClick={() => setExpanded((value) => !value)}
						>
							{expanded ? "Show less" : "Show the full input"}
						</button>
					)}
				</div>
				<span className="shrink-0 text-xs text-muted-foreground">
					{formatRunTimestamp(item.timestamp)}
				</span>
			</div>
			{!item.inputImages?.length && item.inputImageCount ? (
				<div className="flex gap-2">
					{Array.from({ length: item.inputImageCount }).map((_, index) => (
						<Skeleton key={index} className="h-20 w-20 rounded-md" />
					))}
				</div>
			) : null}
			{item.inputImages && item.inputImages.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{item.inputImages.map((image, index) => (
						<img
							key={index}
							src={image.dataUrl}
							alt={`Input image ${index + 1}`}
							className="h-20 w-20 rounded-md border object-cover"
						/>
					))}
				</div>
			)}
		</div>
	);
}

function EmptyState({
	onScenarioClick,
}: {
	onScenarioClick?: (scenario: DecisionScenario) => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-16 text-center">
			<Scale className="mb-6 h-16 w-16 text-muted-foreground/30" />
			<h3 className="mb-2 text-lg font-medium">No decisions yet</h3>
			<p className="mb-8 max-w-md text-sm text-muted-foreground">
				Paste the text to decide on, add a question or two, and run. Each answer
				comes back as a probability instead of prose. Or start from an example:
			</p>
			<AnimatePresence>
				<motion.div
					key="scenarios"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.07, ease: "easeOut" }}
					className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2"
				>
					{decisionScenarios.map((scenario, index) => (
						<motion.button
							key={scenario.label}
							type="button"
							initial={{ opacity: 0, y: -6 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{
								duration: 0.12,
								delay: index * 0.025,
								ease: "easeOut",
							}}
							onClick={() => onScenarioClick?.(scenario)}
							className="rounded-md border px-4 py-3 text-left transition-colors hover:bg-muted/60"
						>
							<div className="text-sm font-medium">{scenario.label}</div>
							<div className="mt-0.5 text-xs text-muted-foreground">
								{scenario.questions
									.map(
										(question) =>
											DECISION_QUESTION_TYPE_LABELS[question.type].label,
									)
									.join(" · ")}
							</div>
						</motion.button>
					))}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}

export function DecisionsGallery({
	items,
	comparisonMode,
	onScenarioClick,
}: DecisionsGalleryProps) {
	if (items.length === 0) {
		return <EmptyState onScenarioClick={onScenarioClick} />;
	}

	return (
		<div className="space-y-10">
			{items.map((item) => (
				<div key={item.id} id={`gallery-${item.id}`} className="space-y-4">
					<RunHeader item={item} />
					{comparisonMode || item.models.length > 1 ? (
						<div
							className={cn(
								"grid gap-6",
								item.models.length === 1
									? "grid-cols-1"
									: item.models.length === 2
										? "grid-cols-1 md:grid-cols-2"
										: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
							)}
						>
							{item.models.map((result, index) => (
								<ModelResult
									key={`${result.modelId}-${index}`}
									result={result}
									item={item}
									showModelName
								/>
							))}
						</div>
					) : item.models[0] ? (
						<div className="max-w-3xl">
							<ModelResult result={item.models[0]} item={item} showModelName />
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}
