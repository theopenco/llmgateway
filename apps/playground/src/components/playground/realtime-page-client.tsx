"use client";

import {
	ChevronDown,
	Mic,
	MicOff,
	Phone,
	PhoneOff,
	Terminal,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { RealtimeSidebar } from "@/components/playground/realtime-sidebar";
import { VoiceActivityIndicator } from "@/components/playground/voice-activity-indicator";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { useUser } from "@/hooks/useUser";
import {
	getModelPreferenceCookie,
	REALTIME_MODEL_COOKIE,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";

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

function formatElapsed(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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
		events,
		userSpeaking,
		assistantSpeaking,
		inputLevel,
		outputLevel,
		start,
		end,
	} = useRealtimeCall({
		model: selectedModel || null,
		voice: voice || null,
		onCallError,
	});

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;
	const inCall = status !== "idle";
	const controlsLocked = inCall;

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
		start();
	}, [posthog, selectedModel, start, voice]);

	const hasBillingContext = !!selectedOrganization && !!selectedProject;

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<RealtimeSidebar
					organizations={organizations}
					selectedOrganization={selectedOrganization}
					onSelectOrganization={handleSelectOrganization}
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
									{formatElapsed(elapsedSeconds)}
								</span>
							)}
						</div>
					</header>

					<div className="flex flex-1 flex-col overflow-y-auto">
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
								<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 p-4">
									{transcript.length === 0 ? (
										<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
											<Phone className="text-muted-foreground/50 h-12 w-12" />
											<p className="text-muted-foreground text-sm">
												{inCall
													? "Say something — the transcript appears here."
													: "Start a call to have a live voice conversation."}
											</p>
										</div>
									) : (
										<div className="flex flex-col gap-3 pb-4">
											{transcript.map((entry) => (
												<div
													key={`${entry.role}-${entry.id}`}
													className={
														entry.role === "user"
															? "self-end max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
															: "self-start max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm"
													}
												>
													{entry.text || "…"}
													{entry.status === "interrupted" && (
														<span className="text-muted-foreground ml-2 text-xs italic">
															(interrupted)
														</span>
													)}
												</div>
											))}
										</div>
									)}
								</div>

								<div className="border-t">
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
									{(usage.responses > 0 || inCall) && (
										<div className="text-muted-foreground mx-auto w-full max-w-3xl px-6 pb-3 text-center text-xs">
											{usage.responses} response
											{usage.responses === 1 ? "" : "s"} ·{" "}
											{usage.inputTokens.toLocaleString()} in /{" "}
											{usage.outputTokens.toLocaleString()} out tokens (
											{usage.audioInputTokens.toLocaleString()} /{" "}
											{usage.audioOutputTokens.toLocaleString()} audio)
										</div>
									)}
									<Collapsible>
										<div className="mx-auto w-full max-w-3xl px-6 pb-4">
											<CollapsibleTrigger asChild>
												<Button
													variant="ghost"
													size="sm"
													className="text-muted-foreground gap-2 text-xs"
												>
													<Terminal className="h-3.5 w-3.5" />
													Event log ({events.length})
													<ChevronDown className="h-3.5 w-3.5" />
												</Button>
											</CollapsibleTrigger>
											<CollapsibleContent>
												<div className="bg-muted/50 mt-2 max-h-64 overflow-y-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed">
													{events.length === 0 ? (
														<div className="text-muted-foreground p-2">
															No events yet.
														</div>
													) : (
														events.map((event) => (
															<div
																key={event.id}
																className="whitespace-pre-wrap break-all"
															>
																<span
																	className={
																		event.direction === "sent"
																			? "text-blue-600 dark:text-blue-400"
																			: "text-muted-foreground"
																	}
																>
																	{event.direction === "sent" ? "→" : "←"}{" "}
																	{event.type}
																</span>{" "}
																{event.payload}
															</div>
														))
													)}
												</div>
											</CollapsibleContent>
										</div>
									</Collapsible>
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
