"use client";

import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
	useRealtimeCall,
	type RealtimeCallStatus,
} from "@/hooks/use-realtime-call";
import {
	useRealtimeHistory,
	useRealtimeHistoryItem,
	useSaveRealtimeHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { deriveCallTitle, formatCallDuration } from "@/lib/call-history";
import {
	getModelPreferenceCookie,
	REALTIME_MODEL_COOKIE,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
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

const STATUS_LABELS: Record<RealtimeCallStatus, string> = {
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
		if (modelParam && realtimeModels.some((m) => m.id === modelParam)) {
			return modelParam;
		}
		const stored =
			getModelPreferenceCookie(REALTIME_MODEL_COOKIE) ?? initialModelPreference;
		if (stored && realtimeModels.some((m) => m.id === stored)) {
			return stored;
		}
		return realtimeModels[0]?.id ?? "";
	});

	const selectedModelDef = useMemo(
		() => realtimeModels.find((m) => m.id === selectedModel) ?? null,
		[realtimeModels, selectedModel],
	);
	const selectedMapping = selectedModelDef?.mappings[0] ?? null;
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
	} = useRealtimeCall({
		model: selectedModel || null,
		voice: voice || null,
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
	const [viewedCallId, setViewedCallId] = useState<string | null>(null);
	const { data: viewedCallData, isLoading: isViewedCallLoading } =
		useRealtimeHistoryItem(inCall ? null : viewedCallId);

	// Persist the transcript once per call, when the call returns to idle. The
	// browser is the only place a realtime transcript exists — the gateway
	// deliberately does not store conversation content.
	const savedCallRef = useRef(false);
	const previousStatusRef = useRef<RealtimeCallStatus>("idle");
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
		savedCallRef.current = true;
		saveCallHistory({
			body: {
				title: deriveCallTitle(spoken),
				model: selectedModel,
				durationSeconds: elapsedSeconds,
				// Upstream item ids are dropped: they identify a session that no
				// longer exists and are not needed to replay the conversation.
				transcript: spoken.map((entry) => ({
					role: entry.role,
					text: entry.text,
					status: entry.status,
					timestamp: entry.timestamp,
				})),
				usage,
				...(voice ? { voice } : {}),
				...(selectedOrganization?.id
					? { organizationId: selectedOrganization.id }
					: {}),
			},
		});
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
			}));
		}
		return transcript.map((entry) => ({
			key: `${entry.role}-${entry.id}`,
			role: entry.role,
			text: entry.text,
			status: entry.status,
		}));
	}, [isViewingHistory, transcript, viewedCall]);

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

	const handleNewCall = useCallback(() => {
		setViewedCallId(null);
		reset();
	}, [reset]);

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
		setViewedCallId(null);
		start();
	}, [posthog, selectedModel, start, voice]);

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
							"flex flex-1 flex-col overflow-y-auto",
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
											{displayedTurns.map((turn) => (
												<div
													key={turn.key}
													className={
														turn.role === "user"
															? "self-end max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
															: "self-start max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm"
													}
												>
													{turn.text || "…"}
													{turn.status === "interrupted" && (
														<span className="text-muted-foreground ml-2 text-xs italic">
															(interrupted)
														</span>
													)}
												</div>
											))}
										</div>
									)}
								</div>

								<div className={cn(!isIdleEmptyState && "border-t")}>
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
											<Button
												size="lg"
												className="gap-2 rounded-full px-8"
												disabled={
													!selectedModel ||
													!isAuthenticated ||
													!hasBillingContext
												}
												onClick={handleStart}
											>
												<Phone className="h-4 w-4" />
												Start call
											</Button>
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
