"use client";

import {
	Mic,
	MicOff,
	Phone,
	PhoneForwarded,
	PhoneOff,
	Play,
	Square,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Action, Actions } from "@/components/ai-elements/actions";
import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { RealtimeSidebar } from "@/components/playground/realtime-sidebar";
import { VoiceActivityIndicator } from "@/components/playground/voice-activity-indicator";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
	useVoiceCall,
	type VoiceCallStatus,
	type VoiceCallTranscriptEntry,
} from "@/hooks/use-voice-call";
import {
	useRealtimeHistory,
	useRealtimeHistoryItem,
	useSaveRealtimeHistory,
	useUpdateRealtimeHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { deriveCallTitle, formatCallDuration } from "@/lib/call-history";
import {
	getModelPreferenceCookie,
	REALTIME_MODEL_COOKIE,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { base64ToBytes } from "@/lib/realtime-audio";
import {
	isKnownModelValue,
	resolveSelectedMapping,
} from "@/lib/realtime-model-value";
import { cn } from "@/lib/utils";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { Organization, Project } from "@/lib/types";

interface RealtimePageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialModelPreference?: string | null;
}

const STATUS_LABELS: Record<VoiceCallStatus, string> = {
	idle: "Ready",
	"preparing-audio": "Preparing audio…",
	"requesting-mic": "Requesting microphone…",
	minting: "Authorizing…",
	connecting: "Connecting…",
	configuring: "Configuring session…",
	live: "Live",
	ending: "Ending…",
};

/**
 * Replayed turns are re-sent to the model as conversation items, so a long
 * thread costs input tokens on the first response of the continued call.
 * Past either threshold the user gets a heads-up rather than a surprise bill.
 */
const REPLAY_TURN_WARNING = 20;
const REPLAY_CHAR_WARNING = 8000;
/** Marks a turn that came from the continued call rather than this session. */
const SEED_ID_PREFIX = "seed-";
/** How close to the bottom still counts as "following" the live transcript. */
const FOLLOW_TRANSCRIPT_THRESHOLD_PX = 64;

/**
 * Restrict the catalogue to models that have at least one active realtime
 * mapping, and copy each surviving model with only those mappings so the
 * ModelSelector (which does not capability-filter by mode) cannot offer a
 * non-realtime provider.
 */
function restrictToRealtimeModels(models: ApiModel[]): ApiModel[] {
	const now = Date.now();
	return models
		.map((model) => {
			const realtimeMappings = model.mappings.filter(
				(mapping) =>
					mapping.realtime === true &&
					mapping.status === "active" &&
					(!mapping.deactivatedAt ||
						new Date(mapping.deactivatedAt).getTime() > now),
			);
			return { ...model, mappings: realtimeMappings };
		})
		.filter((model) => model.mappings.length > 0)
		.sort((a, b) => {
			const dateA = a.releasedAt ? new Date(a.releasedAt).getTime() : 0;
			const dateB = b.releasedAt ? new Date(b.releasedAt).getTime() : 0;
			return dateB - dateA;
		});
}

export default function RealtimePageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects: _projects,
	selectedProject,
	initialModelPreference,
}: RealtimePageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const posthog = usePostHog();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	const realtimeModels = useMemo(
		() => restrictToRealtimeModels(models),
		[models],
	);

	const [selectedModel, setSelectedModel] = useState<string>(() => {
		const modelParam = searchParams.get("model");
		if (modelParam && isKnownModelValue(realtimeModels, modelParam)) {
			return modelParam;
		}
		const stored =
			getModelPreferenceCookie(REALTIME_MODEL_COOKIE) ?? initialModelPreference;
		if (stored && isKnownModelValue(realtimeModels, stored)) {
			return stored;
		}
		return realtimeModels[0]?.id ?? "";
	});

	// A provider-pinned selection must resolve to that provider's mapping: it
	// decides both the voice list and which wire protocol the call speaks, and
	// the gateway pins the same mapping from the same model string.
	const selectedMapping = useMemo(
		() => resolveSelectedMapping(realtimeModels, selectedModel),
		[realtimeModels, selectedModel],
	);
	const voices = useMemo(
		() => selectedMapping?.supportedVoices ?? [],
		[selectedMapping],
	);
	const [voice, setVoice] = useState<string>(() => voices[0] ?? "");

	// Voices are mapping-specific: reset the selection whenever the current
	// one isn't valid for the newly selected model.
	useEffect(() => {
		if (voices.length > 0 && !voices.includes(voice)) {
			setVoice(voices[0]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [voices]);

	useEffect(() => {
		if (selectedModel) {
			setModelPreferenceCookie(REALTIME_MODEL_COOKIE, selectedModel);
		}
	}, [selectedModel]);

	const onCallError = useCallback((message: string) => {
		toast.error(message);
	}, []);

	const {
		status,
		muted,
		setMuted,
		elapsedSeconds,
		transcript,
		usage,
		userSpeaking,
		assistantSpeaking,
		inputLevel,
		outputLevel,
		start,
		end,
		reset,
		supportsResume,
	} = useVoiceCall({
		model: selectedModel || null,
		voice: voice || null,
		projectId: selectedProject?.id ?? null,
		// Realtime mappings are already filtered to the active ones, so the first
		// mapping is the provider the gateway will pin the session to.
		provider: selectedMapping?.providerId ?? null,
		onCallError,
	});

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;
	const inCall = status !== "idle";
	const controlsLocked = inCall;

	const { data: historyData, isLoading: isHistoryLoading } = useRealtimeHistory(
		isAuthenticated,
		selectedOrganization?.id,
	);
	const { mutate: saveCallHistory } = useSaveRealtimeHistory();
	const { mutate: updateCallHistory } = useUpdateRealtimeHistory();
	const [viewedCallId, setViewedCallId] = useState<string | null>(null);
	const { data: viewedCallData, isLoading: isViewedCallLoading } =
		useRealtimeHistoryItem(inCall ? null : viewedCallId);

	// Persist the transcript once per call, when the call returns to idle. The
	// browser is the only place a realtime transcript exists — the gateway
	// deliberately does not store conversation content.
	const savedCallRef = useRef(false);
	const previousStatusRef = useRef<VoiceCallStatus>("idle");
	// Set while this session continues a saved call: its turns are appended to
	// that row instead of starting a second history entry.
	const continuedCallIdRef = useRef<string | null>(null);
	// Latest-ref so the unmount cleanup below saves current (not first-render)
	// call state.
	const persistCallRef = useRef<() => void>(() => {});
	persistCallRef.current = () => {
		if (savedCallRef.current) {
			return;
		}
		const spoken = transcript.filter((entry) => entry.text.trim().length > 0);
		if (spoken.length === 0 || !selectedModel) {
			return;
		}
		const continuedCallId = continuedCallIdRef.current;
		// Upstream item ids are dropped: they identify a session that no longer
		// exists and are not needed to replay the conversation.
		const toEntry = (entry: VoiceCallTranscriptEntry) => ({
			role: entry.role,
			text: entry.text,
			status: entry.status,
			timestamp: entry.timestamp,
			...(entry.audio ? { audio: entry.audio } : {}),
		});

		if (continuedCallId) {
			// Replayed turns are already stored on the row being continued.
			const newTurns = spoken.filter(
				(entry) => !entry.id.startsWith(SEED_ID_PREFIX),
			);
			if (newTurns.length === 0) {
				// Nothing new was said, so there is nothing to append — but the
				// session still belongs to that call, and leaving it deselected would
				// hide both its header and the button to continue it again.
				setViewedCallId(continuedCallId);
				return;
			}
			savedCallRef.current = true;
			// Duration and usage are session-only counters; the server adds them
			// to what the row already holds.
			updateCallHistory(
				{
					params: { path: { id: continuedCallId } },
					body: {
						appendTranscript: newTurns.map(toEntry),
						addDurationSeconds: elapsedSeconds,
						addUsage: usage,
					},
				},
				// Reopen the call so its summary header is there as soon as the call
				// ends, instead of only after picking it out of the sidebar. Settled
				// rather than success: a failed append still has to return the user
				// to the call they were on. The hook seeds the detail cache before
				// this runs, so the reopen reads from memory without a loading flash.
				{ onSettled: () => setViewedCallId(continuedCallId) },
			);
			return;
		}

		savedCallRef.current = true;
		saveCallHistory(
			{
				body: {
					title: deriveCallTitle(spoken),
					model: selectedModel,
					durationSeconds: elapsedSeconds,
					transcript: spoken.map(toEntry),
					usage,
					...(voice ? { voice } : {}),
					...(selectedOrganization?.id
						? { organizationId: selectedOrganization.id }
						: {}),
				},
			},
			{ onSuccess: (data) => setViewedCallId(data.item.id) },
		);
	};
	useEffect(() => {
		const previous = previousStatusRef.current;
		previousStatusRef.current = status;
		if (status !== "idle" || previous === "idle") {
			return;
		}
		persistCallRef.current();
	}, [status]);
	// Every nav link stays clickable during a live call, and navigating away
	// unmounts this component before the idle transition above can fire —
	// without this, the transcript would be silently lost. previousStatusRef
	// stays "idle" until a call starts, which keeps strict-mode's simulated
	// unmount from saving anything. The mutation outlives the component: its
	// hook-level onSuccess is captured at mutate() time.
	useEffect(() => {
		return () => {
			if (previousStatusRef.current !== "idle") {
				persistCallRef.current();
			}
		};
	}, []);

	const historyItems = useMemo(
		() => historyData?.items ?? [],
		[historyData?.items],
	);
	const viewedCall = viewedCallData?.item ?? null;
	const isViewingHistory = !inCall && !!viewedCallId;

	// Saved turns carry no upstream item id, so they are keyed by position.
	const displayedTurns = useMemo(() => {
		if (isViewingHistory) {
			return (viewedCall?.transcript ?? []).map((entry, index) => ({
				key: `saved-${index}`,
				role: entry.role,
				text: entry.text,
				status: entry.status,
				audio: entry.audio,
			}));
		}
		return transcript.map((entry) => ({
			key: `${entry.role}-${entry.id}`,
			role: entry.role,
			text: entry.text,
			status: entry.status,
			audio: entry.audio,
		}));
	}, [isViewingHistory, transcript, viewedCall]);

	// One clip plays at a time, decoded into a blob URL on demand so the base64
	// WAVs are not eagerly turned into objects for every turn on screen.
	const [playingKey, setPlayingKey] = useState<string | null>(null);
	const audioElementRef = useRef<HTMLAudioElement | null>(null);
	const blobUrlRef = useRef<string | null>(null);

	const stopPlayback = useCallback(() => {
		const element = audioElementRef.current;
		audioElementRef.current = null;
		if (element) {
			// Detached first so a late "ended" from the outgoing clip cannot clear
			// the state of the one replacing it.
			element.onended = null;
			element.pause();
		}
		if (blobUrlRef.current) {
			URL.revokeObjectURL(blobUrlRef.current);
			blobUrlRef.current = null;
		}
		setPlayingKey(null);
	}, []);

	const playTurnAudio = useCallback(
		(key: string, base64: string) => {
			stopPlayback();
			const url = URL.createObjectURL(
				new Blob([base64ToBytes(base64)], { type: "audio/wav" }),
			);
			blobUrlRef.current = url;
			const element = new Audio(url);
			audioElementRef.current = element;
			element.onended = stopPlayback;
			setPlayingKey(key);
			void element.play().catch(() => {
				toast.error("Could not play this turn.");
				stopPlayback();
			});
		},
		[stopPlayback],
	);

	// Whatever is playing belongs to the turns on screen: opening another call,
	// closing one, or starting a new call invalidates it — as does unmounting.
	useEffect(() => {
		return () => {
			stopPlayback();
		};
	}, [inCall, stopPlayback, viewedCallId]);

	// A turn's audio is attached at response.done, while the live scheduler is
	// often still draining the tail of that same speech. Replaying it then would
	// play the response over itself, so manual playback yields to the call.
	useEffect(() => {
		if (assistantSpeaking) {
			stopPlayback();
		}
	}, [assistantSpeaking, stopPlayback]);

	const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
	const followTranscriptRef = useRef(true);

	const handleTranscriptScroll = useCallback(
		(event: React.UIEvent<HTMLDivElement>) => {
			const element = event.currentTarget;
			followTranscriptRef.current =
				element.scrollHeight - element.scrollTop - element.clientHeight <
				FOLLOW_TRANSCRIPT_THRESHOLD_PX;
		},
		[],
	);

	// Each conversation opens pinned to its newest turn, regardless of where the
	// previous one was left scrolled.
	useEffect(() => {
		followTranscriptRef.current = true;
	}, [inCall, viewedCallId]);

	// Follow the live transcript only while the user is already at the bottom, so
	// scrolling back to re-read or replay an earlier turn is not yanked away.
	useEffect(() => {
		const element = transcriptScrollRef.current;
		if (element && followTranscriptRef.current) {
			element.scrollTop = element.scrollHeight;
		}
	}, [displayedTurns]);

	const displayedUsage = isViewingHistory
		? viewedCall?.usage
		: usage.responses > 0 || inCall
			? usage
			: null;

	const handleSelectCall = useCallback(
		(itemId: string) => {
			if (inCall) {
				toast.error("End the current call before opening a past one.");
				return;
			}
			setViewedCallId(itemId);
		},
		[inCall],
	);

	// Also reachable from the sidebar mid-call, where clearing the continued-call
	// link would silently strand the live session's turns in a new history row.
	const handleNewCall = useCallback(() => {
		if (inCall) {
			toast.error("End the current call before starting a new one.");
			return;
		}
		continuedCallIdRef.current = null;
		setViewedCallId(null);
		reset();
	}, [inCall, reset]);

	const handleCallDeleted = useCallback((itemId: string) => {
		setViewedCallId((current) => (current === itemId ? null : current));
	}, []);

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	// Ensure the playground API key exists for the selected project, matching
	// the audio page's shell.
	const ensuredProjectRef = useRef<string | null>(null);
	useEffect(() => {
		if (!isAuthenticated || !selectedProject) {
			ensuredProjectRef.current = null;
			return;
		}
		const ensureKey = async () => {
			if (!selectedOrganization) {
				return;
			}
			const projectId = selectedProject.id;
			if (ensuredProjectRef.current === projectId) {
				return;
			}
			try {
				const response = await fetch("/api/ensure-playground-key", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId }),
				});
				if (response.ok && selectedProject.id === projectId) {
					ensuredProjectRef.current = projectId;
				}
			} catch {
				// ignore
			}
		};
		void ensureKey();
	}, [isAuthenticated, selectedOrganization, selectedProject]);

	const handleSelectOrganization = useCallback(
		(org: Organization | null) => {
			const params = new URLSearchParams(Array.from(searchParams.entries()));
			if (org?.id) {
				params.set("orgId", org.id);
			} else {
				params.delete("orgId");
			}
			params.delete("projectId");
			router.push(
				params.toString() ? `/realtime?${params.toString()}` : "/realtime",
			);
		},
		[router, searchParams],
	);

	const handleStart = useCallback(() => {
		posthog.capture("playground_realtime_call_started", {
			model: selectedModel,
			voice,
		});
		savedCallRef.current = false;
		continuedCallIdRef.current = null;
		setViewedCallId(null);
		start();
	}, [posthog, selectedModel, start, voice]);

	// Reopen a saved call as a live one: its turns are replayed to the model as
	// conversation items and the new turns are appended back onto the same row.
	const handleContinueCall = useCallback(() => {
		if (!viewedCall || !selectedModel) {
			return;
		}
		const seed: VoiceCallTranscriptEntry[] = viewedCall.transcript
			.filter(
				(entry) => entry.status !== "partial" && entry.text.trim().length > 0,
			)
			.map((entry, index) => ({
				id: `${SEED_ID_PREFIX}${index}`,
				role: entry.role,
				text: entry.text,
				status: entry.status,
				timestamp: entry.timestamp,
				...(entry.audio ? { audio: entry.audio } : {}),
			}));
		if (seed.length === 0) {
			toast.error("This call has no completed turns to continue from.");
			return;
		}
		if (selectedModel !== viewedCall.model) {
			toast.warning(
				`Continuing with ${selectedModel} — this call was recorded on ${viewedCall.model}.`,
			);
		}
		const totalChars = seed.reduce(
			(total, entry) => total + entry.text.length,
			0,
		);
		if (seed.length > REPLAY_TURN_WARNING || totalChars > REPLAY_CHAR_WARNING) {
			toast.warning(
				`Replaying ${seed.length} turns — the first response will bill the whole conversation as input tokens.`,
			);
		}
		posthog.capture("playground_realtime_call_continued", {
			model: selectedModel,
			voice,
			turns: seed.length,
		});
		savedCallRef.current = false;
		continuedCallIdRef.current = viewedCall.id;
		setViewedCallId(null);
		start(seed);
	}, [posthog, selectedModel, start, viewedCall, voice]);

	const hasBillingContext = !!selectedOrganization && !!selectedProject;
	const isIdleEmptyState =
		!inCall && !isViewingHistory && displayedTurns.length === 0;

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<RealtimeSidebar
					organizations={organizations}
					selectedOrganization={selectedOrganization}
					onSelectOrganization={handleSelectOrganization}
					historyItems={historyItems}
					isHistoryLoading={isHistoryLoading}
					currentItemId={viewedCallId}
					onNewCall={handleNewCall}
					onItemClick={handleSelectCall}
					onItemDeleted={handleCallDeleted}
				/>
				<div className="flex flex-1 flex-col min-w-0">
					<header className="bg-background flex items-center gap-3 border-b p-4">
						<SidebarTrigger />
						<div className="flex w-full min-w-0 max-w-[360px] items-center gap-2 sm:max-w-[420px]">
							<ModelSelector
								models={realtimeModels}
								providers={providers}
								value={selectedModel}
								onValueChange={setSelectedModel}
								placeholder="Select a realtime model..."
								mode="realtime"
								isOptionDisabled={() => controlsLocked}
							/>
						</div>
						{voices.length > 0 && (
							<div className="flex items-center gap-2">
								<Label
									htmlFor="realtime-voice"
									className="text-muted-foreground text-xs whitespace-nowrap"
								>
									Voice
								</Label>
								<Select
									value={voice}
									onValueChange={setVoice}
									disabled={controlsLocked}
								>
									<SelectTrigger id="realtime-voice" className="w-[130px]">
										<SelectValue placeholder="Voice" />
									</SelectTrigger>
									<SelectContent>
										{voices.map((v) => (
											<SelectItem key={v} value={v}>
												{v.charAt(0).toUpperCase() + v.slice(1)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						<div className="ml-auto flex items-center gap-3 text-sm">
							<span
								className={
									status === "live"
										? "flex items-center gap-1.5 text-green-600 dark:text-green-400"
										: "text-muted-foreground"
								}
							>
								{status === "live" && (
									<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
								)}
								{STATUS_LABELS[status]}
							</span>
							{inCall && (
								<span className="text-muted-foreground tabular-nums">
									{formatCallDuration(elapsedSeconds)}
								</span>
							)}
						</div>
					</header>

					<div
						className={cn(
							"flex min-h-0 flex-1 flex-col",
							isIdleEmptyState && "justify-center",
						)}
					>
						{!hasBillingContext && isAuthenticated ? (
							<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
								<Phone className="text-muted-foreground/50 h-12 w-12" />
								<p className="font-medium">
									Voice calls need a pay-as-you-go organization
								</p>
								<p className="text-muted-foreground max-w-md text-sm">
									Realtime voice calls are billed against a regular
									pay-as-you-go organization with credits. Create one in the
									dashboard, then come back here.
								</p>
								<Button asChild variant="outline" size="sm">
									<a
										href={
											process.env.NODE_ENV === "development"
												? "http://localhost:3002/dashboard"
												: "https://llmgateway.io/dashboard"
										}
										target="_blank"
										rel="noopener noreferrer"
									>
										Open dashboard
									</a>
								</Button>
							</div>
						) : (
							<>
								{/* Only the transcript scrolls: the call controls below stay
								    on screen no matter how long the conversation gets. */}
								<div
									ref={transcriptScrollRef}
									onScroll={handleTranscriptScroll}
									className={cn(
										"flex flex-col",
										!isIdleEmptyState && "min-h-0 flex-1 overflow-y-auto",
									)}
								>
									<div
										className={cn(
											"mx-auto flex w-full max-w-3xl flex-col gap-3 p-4",
											!isIdleEmptyState && "flex-1",
										)}
									>
										{isViewingHistory && viewedCall && (
											<div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-xs">
												<span className="text-sm font-medium">
													{viewedCall.title}
												</span>
												<span className="text-muted-foreground">
													{new Date(viewedCall.createdAt).toLocaleString()}
												</span>
												<span className="text-muted-foreground tabular-nums">
													{formatCallDuration(viewedCall.durationSeconds)}
												</span>
												<span className="text-muted-foreground">
													{viewedCall.model}
													{viewedCall.voice ? ` · ${viewedCall.voice}` : ""}
												</span>
												<Button
													variant="ghost"
													size="sm"
													className="text-muted-foreground ml-auto h-7 text-xs"
													onClick={handleNewCall}
												>
													Close
												</Button>
											</div>
										)}
										{displayedTurns.length === 0 ? (
											<div
												className={cn(
													"flex flex-col items-center justify-center gap-3 text-center",
													!isIdleEmptyState && "flex-1",
												)}
											>
												<Phone className="text-muted-foreground/50 h-12 w-12" />
												<p className="text-muted-foreground text-sm">
													{isViewedCallLoading
														? "Loading transcript…"
														: inCall
															? "Say something — the transcript appears here."
															: "Start a call to have a live voice conversation."}
												</p>
											</div>
										) : (
											<div className="flex flex-col gap-3 pb-4">
												{displayedTurns.map((turn) => {
													const audio = turn.audio;
													const isPlaying = playingKey === turn.key;
													return (
														<div
															key={turn.key}
															className={cn(
																"flex max-w-[80%] flex-col gap-0.5",
																turn.role === "user"
																	? "items-end self-end"
																	: "items-start self-start",
															)}
														>
															<div
																className={
																	turn.role === "user"
																		? "rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
																		: "rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm"
																}
															>
																{turn.text || "…"}
																{turn.status === "interrupted" && (
																	<span className="text-muted-foreground ml-2 text-xs italic">
																		(interrupted)
																	</span>
																)}
															</div>
															{audio && (
																<Actions>
																	<Action
																		disabled={assistantSpeaking}
																		onClick={() =>
																			isPlaying
																				? stopPlayback()
																				: playTurnAudio(turn.key, audio.base64)
																		}
																		label={isPlaying ? "Stop" : "Play"}
																		tooltip={
																			assistantSpeaking
																				? "Wait for the assistant to finish"
																				: isPlaying
																					? "Stop playback"
																					: "Play this response"
																		}
																	>
																		{isPlaying ? (
																			<Square className="size-3" />
																		) : (
																			<Play className="size-3" />
																		)}
																	</Action>
																</Actions>
															)}
														</div>
													);
												})}
											</div>
										)}
									</div>
								</div>

								<div
									className={cn("shrink-0", !isIdleEmptyState && "border-t")}
								>
									{status === "live" && (
										<div className="mx-auto flex w-full max-w-3xl items-center justify-center pt-5">
											<VoiceActivityIndicator
												live
												muted={muted}
												userSpeaking={userSpeaking}
												assistantSpeaking={assistantSpeaking}
												inputLevel={inputLevel}
												outputLevel={outputLevel}
											/>
										</div>
									)}
									<div className="mx-auto flex w-full max-w-3xl items-center justify-center gap-4 p-6">
										{!inCall ? (
											<>
												<Button
													size="lg"
													className="gap-2 rounded-full px-8"
													disabled={
														!selectedModel ||
														// Without a resolved mapping the provider — and so the
														// wire protocol the call must speak — is unknown.
														!selectedMapping ||
														!isAuthenticated ||
														!hasBillingContext
													}
													onClick={handleStart}
												>
													<Phone className="h-4 w-4" />
													Start call
												</Button>
												{isViewingHistory && supportsResume && (
													<Button
														size="lg"
														variant="outline"
														className="gap-2 rounded-full px-8"
														disabled={
															!selectedModel ||
															!selectedMapping ||
															!isAuthenticated ||
															!hasBillingContext
														}
														onClick={handleContinueCall}
													>
														<PhoneForwarded className="h-4 w-4" />
														Continue call
													</Button>
												)}
											</>
										) : (
											<>
												<Button
													size="lg"
													variant={muted ? "secondary" : "outline"}
													className="gap-2 rounded-full"
													onClick={() => setMuted(!muted)}
													disabled={status !== "live"}
												>
													{muted ? (
														<MicOff className="h-4 w-4" />
													) : (
														<Mic className="h-4 w-4" />
													)}
													{muted ? "Unmute" : "Mute"}
												</Button>
												<Button
													size="lg"
													variant="destructive"
													className="gap-2 rounded-full px-8"
													onClick={end}
												>
													<PhoneOff className="h-4 w-4" />
													End call
												</Button>
											</>
										)}
									</div>
									{displayedUsage && (
										<div className="text-muted-foreground mx-auto w-full max-w-3xl px-6 pb-3 text-center text-xs">
											{displayedUsage.responses} response
											{displayedUsage.responses === 1 ? "" : "s"} ·{" "}
											{displayedUsage.inputTokens.toLocaleString()} in /{" "}
											{displayedUsage.outputTokens.toLocaleString()} out tokens
											({displayedUsage.audioInputTokens.toLocaleString()} /{" "}
											{displayedUsage.audioOutputTokens.toLocaleString()} audio)
										</div>
									)}
								</div>
							</>
						)}
					</div>
				</div>
			</div>
			<AuthDialog open={showAuthDialog} returnUrl={returnUrl} />
		</SidebarProvider>
	);
}
