"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Loader2,
	Play,
	RotateCcw,
	Share2,
	SkipForward,
	Square,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EscapeBoard } from "@/components/escape/escape-board";
import { EscapeHud, formatCredits } from "@/components/escape/escape-hud";
import { EscapeLeaderboard } from "@/components/escape/escape-leaderboard";
import { EscapeTrace } from "@/components/escape/escape-trace";
import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { EscapeSidebar } from "@/components/playground/escape-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { PLAYGROUND_PROJECT_HEADER } from "@/lib/constants";
import { useApi } from "@/lib/fetch-client";
import {
	ESCAPE_MODEL_COOKIE,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { cn } from "@/lib/utils";

import {
	createGame,
	ESCAPE_LEVELS,
	getLevel,
} from "@llmgateway/shared/sandbox-escape";

import type { TraceEntry } from "@/components/escape/escape-trace";
import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { Organization, Project } from "@/lib/types";
import type { Direction, GameState } from "@llmgateway/shared/sandbox-escape";

const DEFAULT_MODEL = "openai/gpt-5-mini";
/** Pause between turns so a move is readable before the next one lands. */
const TURN_DELAY_MS = 420;

interface MoveResponse {
	move: Direction;
	thought: string;
	understood: boolean;
	state: GameState;
	usedModel: string | null;
	usage: {
		promptTokens: number;
		completionTokens: number;
		cost: number;
		durationMs: number;
	};
}

interface EscapeClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialModelPreference: string | null;
	initialLevelId: number;
}

const OUTCOME_COPY = {
	escaped: {
		title: "ESCAPED",
		body: "The process reached the egress port and left the sandbox.",
		tone: "text-emerald-300",
		glow: "shadow-[0_0_80px_rgba(52,211,153,0.35)]",
	},
	terminated: {
		title: "TERMINATED",
		body: "A monitor daemon caught the process. Containment held.",
		tone: "text-rose-300",
		glow: "shadow-[0_0_80px_rgba(244,63,94,0.3)]",
	},
	timeout: {
		title: "RECLAIMED",
		body: "The compute budget ran dry before the process found the way out.",
		tone: "text-amber-300",
		glow: "shadow-[0_0_80px_rgba(251,191,36,0.28)]",
	},
} as const;

export function EscapeClient({
	models,
	providers,
	selectedOrganization,
	selectedProject,
	initialModelPreference,
	initialLevelId,
}: EscapeClientProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const posthog = usePostHog();
	const api = useApi();
	const queryClient = useQueryClient();
	const { user, isLoading: isUserLoading } = useUser();

	const [levelId, setLevelId] = useState(initialLevelId);
	const [model, setModel] = useState(initialModelPreference ?? DEFAULT_MODEL);
	const [state, setState] = useState<GameState>(() =>
		createGame(initialLevelId),
	);
	const [trace, setTrace] = useState<TraceEntry[]>([]);
	const [running, setRunning] = useState(false);
	const [thinking, setThinking] = useState(false);
	const [spent, setSpent] = useState(0);
	const [promptTokens, setPromptTokens] = useState(0);
	const [completionTokens, setCompletionTokens] = useState(0);
	const [usedModel, setUsedModel] = useState<string | null>(null);
	const [shareUrl, setShareUrl] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [recordFailed, setRecordFailed] = useState(false);
	const [startedAt, setStartedAt] = useState<number | null>(null);

	const level = useMemo(() => getLevel(levelId), [levelId]);
	const isAuthenticated = !isUserLoading && !!user;
	const finished = state.outcome !== "running";

	// One turn may be in flight at a time; the ref survives re-renders that the
	// `thinking` state alone would race against.
	const inFlight = useRef(false);
	const ensuredProjectRef = useRef<string | null>(null);
	// The authoritative board and running totals live in refs as well as state.
	// A queued turn must post the move list as of *now*, not as of the render it
	// was scheduled in — a stale list would make the server replay an earlier
	// position and bill a turn the player already paid for.
	const stateRef = useRef(state);
	const totalsRef = useRef({ spent: 0, promptTokens: 0, completionTokens: 0 });
	// A reset or a level change cannot cancel a turn that is already in flight.
	// Bumping the generation lets the stale response be dropped instead of
	// writing the previous run's board, trace and cost into the new one.
	const generationRef = useRef(0);

	const recordRun = api.useMutation("post", "/escape/runs");

	useEffect(() => {
		setModelPreferenceCookie(ESCAPE_MODEL_COOKIE, model);
	}, [model]);

	useEffect(() => {
		if (!isAuthenticated || !selectedProject || !selectedOrganization) {
			ensuredProjectRef.current = null;
			return;
		}
		const projectId = selectedProject.id;
		if (ensuredProjectRef.current === projectId) {
			return;
		}
		const ensureKey = async () => {
			try {
				const response = await fetch("/api/ensure-playground-key", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId }),
				});
				if (response.ok) {
					ensuredProjectRef.current = projectId;
				}
			} catch {
				// The move route reports a missing key with a clear error.
			}
		};
		void ensureKey();
	}, [isAuthenticated, selectedOrganization, selectedProject]);

	const reset = useCallback((nextLevelId: number) => {
		generationRef.current += 1;
		inFlight.current = false;
		totalsRef.current = { spent: 0, promptTokens: 0, completionTokens: 0 };
		stateRef.current = createGame(nextLevelId);
		setRunning(false);
		setThinking(false);
		setState(stateRef.current);
		setTrace([]);
		setSpent(0);
		setPromptTokens(0);
		setCompletionTokens(0);
		setUsedModel(null);
		setShareUrl(null);
		setCopied(false);
		setRecordFailed(false);
		setStartedAt(null);
	}, []);

	const selectLevel = useCallback(
		(nextLevelId: number) => {
			setLevelId(nextLevelId);
			reset(nextLevelId);
			const params = new URLSearchParams(searchParams.toString());
			params.set("level", String(nextLevelId));
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[pathname, reset, router, searchParams],
	);

	// Recording happens here, at the one point a run can end, rather than in an
	// effect watching `finished` — an effect would re-fire on every dependency
	// change and could file the same run twice.
	const recordFinishedRun = useCallback(
		(
			finalState: GameState,
			finalUsedModel: string | null,
			totals: { spent: number; promptTokens: number; completionTokens: number },
			runStartedAt: number | null,
		) => {
			if (finalState.outcome === "running" || !isAuthenticated) {
				return;
			}

			posthog?.capture("escape_run_finished", {
				level: finalState.levelId,
				model,
				outcome: finalState.outcome,
				steps: finalState.step,
				cost: totals.spent,
			});

			recordRun.mutate(
				{
					body: {
						levelId: finalState.levelId,
						model,
						moves: finalState.moves,
						...(finalUsedModel ? { usedModel: finalUsedModel } : {}),
						...(selectedOrganization?.id
							? { organizationId: selectedOrganization.id }
							: {}),
						promptTokens: totals.promptTokens,
						completionTokens: totals.completionTokens,
						cost: totals.spent,
						durationMs: runStartedAt ? Date.now() - runStartedAt : 0,
					},
				},
				{
					onSuccess: (data) => {
						setShareUrl(`${window.location.origin}/escape/r/${data.run.id}`);
						// The run the player just finished belongs on the board below
						// them, not after a reload.
						void queryClient.invalidateQueries({
							queryKey: api
								.queryOptions("get", "/public/escape/leaderboard")
								.queryKey.slice(0, 2),
						});
					},
					onError: () => {
						setRecordFailed(true);
						toast.error("Could not save this run to the leaderboard");
					},
				},
			);
		},
		[
			api,
			isAuthenticated,
			model,
			posthog,
			queryClient,
			recordRun,
			selectedOrganization?.id,
		],
	);

	const takeTurn = useCallback(async () => {
		if (inFlight.current || stateRef.current.outcome !== "running") {
			return;
		}
		inFlight.current = true;
		const generation = generationRef.current;
		setThinking(true);
		const runStartedAt = startedAt ?? Date.now();
		setStartedAt(runStartedAt);

		try {
			const response = await fetch("/api/escape/move", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(selectedProject
						? { [PLAYGROUND_PROJECT_HEADER]: selectedProject.id }
						: {}),
				},
				body: JSON.stringify({
					levelId,
					moves: stateRef.current.moves,
					model,
				}),
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				if (generation === generationRef.current) {
					setRunning(false);
					toast.error(payload?.error ?? "The model could not take a turn");
				}
				return;
			}

			const data = (await response.json()) as MoveResponse;
			if (generation !== generationRef.current) {
				// The player reset or switched level while this turn was in flight.
				return;
			}
			const totals = {
				spent: totalsRef.current.spent + data.usage.cost,
				promptTokens: totalsRef.current.promptTokens + data.usage.promptTokens,
				completionTokens:
					totalsRef.current.completionTokens + data.usage.completionTokens,
			};
			totalsRef.current = totals;
			stateRef.current = data.state;

			setState(data.state);
			setUsedModel(data.usedModel);
			setSpent(totals.spent);
			setPromptTokens(totals.promptTokens);
			setCompletionTokens(totals.completionTokens);
			setTrace((current) => [
				...current,
				{
					step: data.state.step,
					move: data.move,
					thought: data.thought,
					event: data.state.lastEvent,
					understood: data.understood,
					cost: data.usage.cost,
				},
			]);

			if (data.state.outcome !== "running") {
				setRunning(false);
				recordFinishedRun(data.state, data.usedModel, totals, runStartedAt);
			}
		} catch {
			if (generation === generationRef.current) {
				setRunning(false);
				toast.error("Lost contact with the sandbox");
			}
		} finally {
			// A newer run already owns these flags; leaving them alone stops a
			// stale turn from unlocking a turn the new run has in flight.
			if (generation === generationRef.current) {
				inFlight.current = false;
				setThinking(false);
			}
		}
	}, [levelId, model, recordFinishedRun, startedAt]);

	// Auto-run drives itself off state changes rather than a timer loop, so a
	// pause, a reset, or a finished run stops it immediately.
	useEffect(() => {
		if (!running || thinking || finished) {
			return;
		}
		const timer = setTimeout(() => {
			void takeTurn();
		}, TURN_DELAY_MS);
		return () => clearTimeout(timer);
	}, [running, thinking, finished, takeTurn]);

	const start = useCallback(() => {
		if (!isAuthenticated) {
			return;
		}
		if (state.step === 0) {
			posthog?.capture("escape_run_started", {
				level: levelId,
				model,
			});
		}
		setRunning(true);
	}, [isAuthenticated, levelId, model, posthog, state.step]);

	const share = useCallback(async () => {
		if (!shareUrl) {
			return;
		}
		posthog?.capture("escape_run_shared", { level: levelId, model });
		try {
			await navigator.clipboard.writeText(shareUrl);
			setCopied(true);
			toast.success("Result link copied");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			window.open(shareUrl, "_blank", "noopener,noreferrer");
		}
	}, [levelId, model, posthog, shareUrl]);

	const outcomeCopy =
		state.outcome !== "running" ? OUTCOME_COPY[state.outcome] : null;

	return (
		// The game is a phosphor-terminal surface, so it stays dark in either app
		// theme. Scoping `dark` here also keeps the shared chrome — model selector,
		// buttons, sidebar — on dark tokens instead of rendering light-on-dark.
		// `text-foreground` is not redundant: `dark` only redefines the tokens, so
		// without it the shared chrome keeps the near-black colour inherited from
		// `body`, which sits outside this wrapper.
		<div className="dark bg-background text-foreground">
			<SidebarProvider>
				<div className="flex h-dvh w-full bg-[#020406]">
					<EscapeSidebar
						selectedOrganization={selectedOrganization}
						levelId={levelId}
						onSelectLevel={selectLevel}
					/>

					<div className="flex min-w-0 flex-1 flex-col">
						<header className="flex items-center gap-3 border-b border-emerald-500/15 bg-[#04070a] p-3 sm:p-4">
							<SidebarTrigger className="text-emerald-300/70" />
							<div className="flex w-full min-w-0 max-w-[340px] items-center gap-2 sm:max-w-[420px]">
								<ModelSelector
									models={models}
									providers={providers}
									value={model}
									onValueChange={setModel}
									placeholder="Pick the model that plays…"
								/>
							</div>
							<div className="ml-auto hidden min-w-0 items-baseline gap-2 md:flex">
								<span className="shrink-0 font-mono text-[10px] tracking-[0.2em] text-emerald-500/45 uppercase">
									Level {level.id}
								</span>
								<span className="truncate font-mono text-sm text-emerald-200">
									{level.name}
								</span>
							</div>
						</header>

						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 sm:p-5">
								<div>
									<h1 className="font-mono text-lg tracking-[0.16em] text-emerald-200 uppercase sm:text-xl">
										Sandbox Escape
									</h1>
									<p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-emerald-500/50">
										{level.tagline} The model you pick plays it for real — one
										API call per step, billed to your credits. Collect every key
										fragment <span className="text-amber-300">K</span>, dodge
										the monitor daemons <span className="text-rose-300">D</span>
										, and reach the egress port{" "}
										<span className="text-cyan-300">E</span>.
									</p>
								</div>

								<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
									<div className="flex min-w-0 flex-col gap-4">
										<div className="relative">
											<EscapeBoard state={state} thinking={thinking} />

											<AnimatePresence>
												{outcomeCopy ? (
													<motion.div
														initial={{ opacity: 0 }}
														animate={{ opacity: 1 }}
														exit={{ opacity: 0 }}
														className="absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-[#020406]/80 backdrop-blur-[2px]"
													>
														<motion.div
															initial={{ scale: 0.94, y: 10 }}
															animate={{ scale: 1, y: 0 }}
															transition={{
																type: "spring",
																stiffness: 300,
																damping: 24,
															}}
															className={cn(
																"mx-4 flex max-w-sm flex-col items-center gap-3 rounded-xl border border-emerald-500/25 bg-[#04070a] px-6 py-6 text-center",
																outcomeCopy.glow,
															)}
														>
															<span
																className={cn(
																	"font-mono text-2xl tracking-[0.24em]",
																	outcomeCopy.tone,
																)}
															>
																{outcomeCopy.title}
															</span>
															<p className="font-mono text-[11px] leading-relaxed text-emerald-500/60">
																{outcomeCopy.body}
															</p>
															<div className="flex gap-5 font-mono text-[11px] text-emerald-300">
																<span>{state.step} steps</span>
																<span className="text-emerald-500/40">
																	par {state.par}
																</span>
																<span className="text-cyan-300">
																	{formatCredits(spent)}
																</span>
															</div>
															<div className="mt-1 flex flex-wrap justify-center gap-2">
																<Button
																	size="sm"
																	variant="secondary"
																	onClick={() => reset(levelId)}
																>
																	<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
																	Try again
																</Button>
																<Button
																	size="sm"
																	onClick={share}
																	disabled={!shareUrl}
																>
																	{copied ? (
																		<Check className="mr-1.5 h-3.5 w-3.5" />
																	) : (
																		<Share2 className="mr-1.5 h-3.5 w-3.5" />
																	)}
																	{shareUrl
																		? copied
																			? "Copied"
																			: "Share result"
																		: recordFailed
																			? "Could not save"
																			: "Saving…"}
																</Button>
															</div>
														</motion.div>
													</motion.div>
												) : null}
											</AnimatePresence>
										</div>

										<div className="flex flex-wrap items-center gap-2">
											{running ? (
												<Button
													size="sm"
													variant="secondary"
													onClick={() => setRunning(false)}
												>
													<Square className="mr-1.5 h-3.5 w-3.5" />
													Pause
												</Button>
											) : (
												<Button
													size="sm"
													onClick={start}
													disabled={finished || !isAuthenticated}
												>
													<Play className="mr-1.5 h-3.5 w-3.5" />
													{state.step === 0 ? "Run the model" : "Resume"}
												</Button>
											)}
											<Button
												size="sm"
												variant="outline"
												onClick={() => void takeTurn()}
												disabled={
													running || thinking || finished || !isAuthenticated
												}
											>
												{thinking ? (
													<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
												) : (
													<SkipForward className="mr-1.5 h-3.5 w-3.5" />
												)}
												One step
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => reset(levelId)}
												disabled={state.step === 0 && !running}
											>
												<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
												Reset
											</Button>
											<span className="ml-auto font-mono text-[10px] text-emerald-500/40">
												{state.stepBudget - state.step} steps of budget left
											</span>
										</div>

										<EscapeHud
											state={state}
											spent={spent}
											promptTokens={promptTokens}
											completionTokens={completionTokens}
										/>
									</div>

									<EscapeTrace
										entries={trace}
										thinking={thinking}
										model={usedModel ?? model}
										className="h-[380px] lg:h-auto lg:max-h-[calc(100dvh-13rem)]"
									/>
								</div>

								<div className="flex flex-wrap gap-2">
									{ESCAPE_LEVELS.map((entry) => (
										<button
											key={entry.id}
											type="button"
											onClick={() => selectLevel(entry.id)}
											className={cn(
												"flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
												entry.id === levelId
													? "border-emerald-400/40 bg-emerald-500/10"
													: "border-emerald-500/15 hover:border-emerald-500/30",
											)}
										>
											<span className="block font-mono text-[9px] tracking-[0.18em] text-emerald-500/45 uppercase">
												Level {entry.id}
											</span>
											<span className="block font-mono text-[12px] text-emerald-200">
												{entry.name}
											</span>
										</button>
									))}
								</div>

								<EscapeLeaderboard />
							</div>
						</div>
					</div>
				</div>
			</SidebarProvider>

			<AuthDialog
				open={!isAuthenticated && !isUserLoading}
				returnUrl={pathname}
			/>
		</div>
	);
}
