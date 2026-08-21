"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, Stamp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v3";

import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

export type SurveyEligibility =
	paths["/model-survey/eligibility"]["get"]["responses"]["200"]["content"]["application/json"];

const USE_CASES = [
	{ value: "agentic_coding", label: "Agentic coding — it drives the editor" },
	{ value: "code_completion", label: "Autocomplete & inline suggestions" },
	{ value: "code_review", label: "Code review" },
	{ value: "debugging", label: "Debugging & fixing" },
	{ value: "writing_tests", label: "Writing tests" },
	{ value: "docs_and_explanations", label: "Docs & explanations" },
	{ value: "other", label: "Something else" },
] as const;

type UseCase = (typeof USE_CASES)[number]["value"];

const scoreSchema = z
	.number({ required_error: "Score it 1–5." })
	.int()
	.min(1, "Score it 1–5.")
	.max(5);

const formSchema = z.object({
	modelId: z.string().min(1, "Pick a model."),
	valueScore: scoreSchema,
	qualityScore: scoreSchema,
	speedScore: scoreSchema,
	wouldRecommend: z.boolean({
		required_error: "Approve or deny — customs insists.",
	}),
	primaryUseCase: z.enum(
		USE_CASES.map((u) => u.value) as [UseCase, ...UseCase[]],
		{ errorMap: () => ({ message: "Pick your main use." }) },
	),
	comment: z
		.string()
		.trim()
		.min(1, "Field notes are required — one honest line is plenty.")
		.max(2000, "Keep it under 2000 characters."),
});

type FormValues = z.infer<typeof formSchema>;

const SCORE_QUESTIONS: {
	name: "valueScore" | "qualityScore" | "speedScore";
	label: string;
	description: string;
	low: string;
	high: string;
}[] = [
	{
		name: "valueScore",
		label: "Worth what it costs?",
		description: "Given the credits it burns, the output earns its keep.",
		low: "Overpriced",
		high: "A steal",
	},
	{
		name: "qualityScore",
		label: "Output quality",
		description: "How often its code survives your review.",
		low: "Rewrites needed",
		high: "Ships as-is",
	},
	{
		name: "speedScore",
		label: "Speed",
		description: "From prompt to usable answer.",
		low: "Coffee break",
		high: "Blink",
	},
];

function ScoreRow({
	value,
	onChange,
	name,
	low,
	high,
}: {
	value: number | undefined;
	onChange: (next: number) => void;
	name: string;
	low: string;
	high: string;
}) {
	return (
		<div>
			<div className="flex items-center gap-2">
				{[1, 2, 3, 4, 5].map((score) => {
					const selected = value === score;
					return (
						<button
							key={score}
							type="button"
							data-testid={`census-${name}-${score}`}
							aria-pressed={selected}
							onClick={() => onChange(score)}
							className={cn(
								"flex h-11 w-11 items-center justify-center rounded-full font-mono text-sm transition-transform",
								selected
									? "rotate-[-6deg] scale-105 border-[3px] border-double border-emerald-700/80 font-bold text-emerald-800 mix-blend-multiply dark:border-emerald-400/70 dark:text-emerald-300 dark:mix-blend-screen"
									: "border-2 border-dashed border-stone-300 text-stone-400 hover:border-stone-400 hover:text-stone-500 dark:border-stone-700 dark:text-stone-600 dark:hover:border-stone-500",
							)}
						>
							{score}
						</button>
					);
				})}
			</div>
			<div className="mt-1.5 flex w-[252px] justify-between font-mono text-[9px] uppercase tracking-[0.15em] text-stone-400 dark:text-stone-500">
				<span>{low}</span>
				<span>{high}</span>
			</div>
		</div>
	);
}

export default function SurveyClient({
	initialEligibility,
}: {
	initialEligibility: SurveyEligibility;
}) {
	const api = useApi();
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();
	const searchParams = useSearchParams();
	const [eligibility, setEligibility] = useState(initialEligibility);
	const [result, setResult] = useState<{
		modelId: string;
		rewardGranted: boolean;
		rewardTier: "lite" | "pro" | "max" | null;
	} | null>(null);

	const requestedModel = searchParams.get("model");
	const openModels = eligibility.topModels.filter((m) => !m.alreadySubmitted);
	const defaultModel =
		openModels.find((m) => m.modelId === requestedModel)?.modelId ??
		openModels[0]?.modelId ??
		"";

	const submitMutation = api.useMutation("post", "/model-survey");

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			modelId: defaultModel,
			comment: "",
		},
	});

	const selectedModel = form.watch("modelId");
	const comment = form.watch("comment");
	const period = `Q${eligibility.quarter} ${eligibility.year}`;
	const serial = `CS-${eligibility.year}Q${eligibility.quarter}-${(selectedModel || "X").slice(0, 6).toUpperCase()}`;

	async function onSubmit(values: FormValues) {
		const trimmedComment = values.comment.trim();
		try {
			const response = await submitMutation.mutateAsync({
				body: {
					modelId: values.modelId,
					valueScore: values.valueScore,
					qualityScore: values.qualityScore,
					speedScore: values.speedScore,
					wouldRecommend: values.wouldRecommend,
					primaryUseCase: values.primaryUseCase,
					comment: trimmedComment,
				},
			});
			if (posthogKey) {
				posthog.capture("model_survey_completed", {
					year: eligibility.year,
					quarter: eligibility.quarter,
					model: values.modelId,
					reward_granted: response.rewardGranted,
				});
			}
			setEligibility((prev) => ({
				...prev,
				rewardAvailable: prev.rewardAvailable && !response.rewardGranted,
				topModels: prev.topModels.map((m) =>
					m.modelId === values.modelId ? { ...m, alreadySubmitted: true } : m,
				),
			}));
			setResult({
				modelId: values.modelId,
				rewardGranted: response.rewardGranted,
				rewardTier: response.rewardTier,
			});
		} catch (error) {
			const message =
				error && typeof error === "object" && "message" in error
					? String((error as { message?: unknown }).message)
					: null;
			toast.error(message || "Couldn't file your census entry. Try again.");
		}
	}

	function rateAnother() {
		const next = eligibility.topModels.find((m) => !m.alreadySubmitted);
		form.reset({
			modelId: next?.modelId ?? "",
			valueScore: undefined,
			qualityScore: undefined,
			speedScore: undefined,
			wouldRecommend: undefined,
			primaryUseCase: undefined,
			comment: "",
		});
		setResult(null);
	}

	if (result) {
		const remaining = eligibility.topModels.filter((m) => !m.alreadySubmitted);
		return (
			<div
				data-testid="census-success"
				className="relative overflow-hidden rounded-xl border border-dashed border-stone-400/70 p-8 text-center dark:border-stone-600/70"
			>
				<motion.div
					initial={{ opacity: 0, scale: 2.4, rotate: -18 }}
					animate={{ opacity: 1, scale: 1, rotate: -6 }}
					transition={{ type: "spring", duration: 0.45 }}
					className="mx-auto inline-block rounded-md border-4 border-double border-emerald-700/80 px-8 py-3 font-mono uppercase text-emerald-800 mix-blend-multiply dark:border-emerald-400/80 dark:text-emerald-300 dark:mix-blend-screen"
				>
					<div className="text-lg font-bold tracking-[0.3em]">Census filed</div>
					<div className="mt-1 text-[10px] tracking-[0.25em]">
						{result.modelId} · {period}
					</div>
				</motion.div>

				{result.rewardGranted ? (
					<motion.p
						data-testid="census-reward"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.35 }}
						className="mt-6 text-sm"
					>
						<Stamp className="mr-1.5 inline h-4 w-4 text-emerald-700 dark:text-emerald-400" />
						A free{" "}
						<span className="font-semibold">
							{result.rewardTier?.toUpperCase()} Reset Pass
						</span>{" "}
						was stamped into your passport. Redeem it any week you fly too close
						to the premium limit.
					</motion.p>
				) : (
					<p className="mt-6 text-sm text-muted-foreground">
						Thanks — your verdict is in the {eligibility.year} registry. Your
						passport already holds this quarter&apos;s census pass; a fresh one
						comes with the next wave.
					</p>
				)}

				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Button asChild>
						<Link href="/dashboard">Back to the dashboard</Link>
					</Button>
					{remaining.length > 0 && (
						<Button variant="outline" onClick={rateAnother}>
							Rate another model
						</Button>
					)}
					<Button asChild variant="ghost">
						<Link href={`/data/${eligibility.year}`}>
							See the census
							<ArrowUpRight className="ml-1 h-4 w-4" />
						</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
				<div className="space-y-2">
					<div className="flex items-baseline justify-between">
						<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
							DevPass Model Census · {period}
						</div>
						<div className="font-mono text-[9px] tracking-[0.25em] text-stone-400 dark:text-stone-500">
							No. {serial}
						</div>
					</div>
					<h1 className="text-2xl font-semibold text-balance">
						One minute of honesty about the models you fly with
					</h1>
					<p className="text-sm text-muted-foreground">
						Which coding models are actually worth their price? Your answers are
						anonymous, aggregated into the public census, and your first entry
						of each quarterly wave stamps a free Reset Pass into your passport.
						{!eligibility.rewardAvailable &&
							" (This quarter's pass is already in your passport.)"}
					</p>
				</div>

				<FormField
					control={form.control}
					name="modelId"
					render={({ field }) => (
						<FormItem className="space-y-3">
							<FormLabel className="text-sm font-medium">
								Model under review
							</FormLabel>
							<FormControl>
								<div className="flex flex-wrap gap-2">
									{eligibility.topModels.map((model) => {
										const selected = field.value === model.modelId;
										return (
											<button
												key={model.modelId}
												type="button"
												data-testid={`census-model-${model.modelId}`}
												disabled={model.alreadySubmitted}
												onClick={() => field.onChange(model.modelId)}
												className={cn(
													"rounded-lg border px-3 py-2 text-left font-mono text-xs transition-colors",
													model.alreadySubmitted &&
														"cursor-not-allowed border-dashed opacity-50",
													selected
														? "border-emerald-700/70 bg-emerald-500/5 text-emerald-800 dark:border-emerald-400/60 dark:text-emerald-300"
														: "hover:bg-muted/50",
												)}
											>
												<span className="font-semibold">{model.modelId}</span>
												<span className="mt-0.5 block text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
													{model.alreadySubmitted
														? "Filed"
														: `${model.requestCount.toLocaleString()} reqs / ${eligibility.windowDays}d`}
												</span>
											</button>
										);
									})}
								</div>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				{SCORE_QUESTIONS.map((question) => (
					<FormField
						key={question.name}
						control={form.control}
						name={question.name}
						render={({ field }) => (
							<FormItem className="space-y-3">
								<div>
									<FormLabel className="text-sm font-medium">
										{question.label}
									</FormLabel>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{question.description}
									</p>
								</div>
								<FormControl>
									<ScoreRow
										value={field.value}
										onChange={field.onChange}
										name={question.name}
										low={question.low}
										high={question.high}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				))}

				<FormField
					control={form.control}
					name="wouldRecommend"
					render={({ field }) => (
						<FormItem className="space-y-3">
							<FormLabel className="text-sm font-medium">
								Would you recommend {selectedModel || "it"} to another
								developer?
							</FormLabel>
							<FormControl>
								<div className="flex gap-3">
									<button
										type="button"
										data-testid="census-recommend-yes"
										aria-pressed={field.value === true}
										onClick={() => field.onChange(true)}
										className={cn(
											"rounded-md border-2 px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] transition-transform",
											field.value === true
												? "rotate-[-3deg] scale-105 border-double border-[3px] border-emerald-700/80 text-emerald-800 mix-blend-multiply dark:border-emerald-400/70 dark:text-emerald-300 dark:mix-blend-screen"
												: "border-dashed border-stone-300 text-stone-400 hover:border-stone-400 dark:border-stone-700 dark:text-stone-600",
										)}
									>
										Approved
									</button>
									<button
										type="button"
										data-testid="census-recommend-no"
										aria-pressed={field.value === false}
										onClick={() => field.onChange(false)}
										className={cn(
											"rounded-md border-2 px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] transition-transform",
											field.value === false
												? "rotate-[2deg] scale-105 border-double border-[3px] border-rose-700/80 text-rose-800 mix-blend-multiply dark:border-rose-400/70 dark:text-rose-300 dark:mix-blend-screen"
												: "border-dashed border-stone-300 text-stone-400 hover:border-stone-400 dark:border-stone-700 dark:text-stone-600",
										)}
									>
										Denied
									</button>
								</div>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="primaryUseCase"
					render={({ field }) => (
						<FormItem className="space-y-3">
							<FormLabel className="text-sm font-medium">
								What do you mainly use it for?
							</FormLabel>
							<Select value={field.value} onValueChange={field.onChange}>
								<FormControl>
									<SelectTrigger data-testid="census-use-case">
										<SelectValue placeholder="Pick your main use" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									{USE_CASES.map((useCase) => (
										<SelectItem key={useCase.value} value={useCase.value}>
											{useCase.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="comment"
					render={({ field }) => (
						<FormItem>
							<FormLabel className="text-sm font-medium">Field notes</FormLabel>
							<FormControl>
								<Textarea
									rows={4}
									maxLength={2000}
									placeholder="Where it shines, where it face-plants, what you'd tell a teammate."
									{...field}
								/>
							</FormControl>
							<div className="flex items-center justify-between">
								<FormMessage />
								<p className="ml-auto text-xs text-muted-foreground">
									{comment.length}/2000
								</p>
							</div>
						</FormItem>
					)}
				/>

				<div className="flex items-center justify-between gap-3">
					<Button asChild variant="ghost">
						<Link href="/dashboard">Not now</Link>
					</Button>
					<Button
						type="submit"
						data-testid="census-submit"
						disabled={submitMutation.isPending}
					>
						<Stamp className="mr-1.5 h-4 w-4" />
						{submitMutation.isPending ? "Filing…" : "File census entry"}
					</Button>
				</div>

				<AnimatePresence>
					{eligibility.rewardAvailable && (
						<motion.p
							exit={{ opacity: 0 }}
							className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500"
						>
							Reward on file: 1 free Reset Pass · granted on your first entry of
							the {period} wave
						</motion.p>
					)}
				</AnimatePresence>
			</form>
		</Form>
	);
}
