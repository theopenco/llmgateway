"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { AudioControls } from "@/components/playground/audio-controls";
import { AudioGallery } from "@/components/playground/audio-gallery";
import { AudioHeader } from "@/components/playground/audio-header";
import { AudioSidebar } from "@/components/playground/audio-sidebar";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatPlanUpsell } from "@/components/pricing/chat-plan-upsell";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
	useAudioHistory,
	useSaveAudioHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { getModelAudioConfig } from "@/lib/audio-gen";
import {
	chatPlanCreditErrorMessage,
	isInsufficientCreditsError,
} from "@/lib/credit-error";
import { useApi } from "@/lib/fetch-client";
import { mapModels } from "@/lib/mapmodels";
import {
	AUDIO_MODEL_COOKIE,
	getModelPreferenceCookie,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { shouldDisableFallback } from "@/lib/no-fallback";

import type { AudioFormat, AudioGalleryItem } from "@/lib/audio-gen";
import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { ComboboxModel, Organization, Project } from "@/lib/types";

interface AudioPageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialModelPreference?: string | null;
}

export default function AudioPageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects: _projects,
	selectedProject,
	initialModelPreference,
}: AudioPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const api = useApi();
	const posthog = usePostHog();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	// Filter models to audio-gen (text-to-speech) only, sorted newest-first by
	// releasedAt with createdAt as fallback. releasedAt comes from the static
	// model definition so the order is stable regardless of when each row was
	// inserted into the gateway DB.
	const audioGenModels = useMemo(
		() =>
			models
				.filter((m) => m.output?.includes("audio"))
				.slice()
				.sort((a, b) => {
					const dateA = a.releasedAt
						? new Date(a.releasedAt).getTime()
						: a.createdAt
							? new Date(a.createdAt).getTime()
							: 0;
					const dateB = b.releasedAt
						? new Date(b.releasedAt).getTime()
						: b.createdAt
							? new Date(b.createdAt).getTime()
							: 0;
					return dateB - dateA;
				}),
		[models],
	);

	const mapped = useMemo(
		() => mapModels(audioGenModels, providers),
		[audioGenModels, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	// State — initialize from URL params, then cookie, then default
	const [selectedModels, setSelectedModels] = useState<string[]>(() => {
		const modelParam = searchParams.get("model");
		if (modelParam) {
			const models = modelParam.split(",").filter(Boolean);
			if (models.length > 0) {
				return models;
			}
		}
		const stored =
			getModelPreferenceCookie(AUDIO_MODEL_COOKIE) ?? initialModelPreference;
		if (stored) {
			const models = stored.split(",").filter(Boolean);
			if (models.length > 0) {
				return models;
			}
		}
		const first = audioGenModels[0];
		return first ? [first.id] : [];
	});
	const [comparisonMode, setComparisonMode] = useState(
		() => searchParams.get("compare") === "1",
	);
	const [prompt, setPrompt] = useState("");
	const [activeItems, setActiveItems] = useState<AudioGalleryItem[]>([]);
	const audioIdFromUrl = searchParams.get("id");
	const [selectedItemId, setSelectedItemId] = useState<string | null>(
		audioIdFromUrl,
	);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showTopUp, setShowTopUp] = useState(false);

	// Audio config state
	const [voice, setVoice] = useState<string>(() => {
		const primaryModel = selectedModels[0] ?? "";
		return getModelAudioConfig(primaryModel).defaultVoice;
	});
	const [audioFormat, setAudioFormat] = useState<AudioFormat>(() => {
		const primaryModel = selectedModels[0] ?? "";
		return getModelAudioConfig(primaryModel).defaultFormat;
	});
	const [speed, setSpeed] = useState<number>(1);
	const [instructions, setInstructions] = useState("");

	// Auth
	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	// DB-persisted history
	const { data: historyData, isLoading: isHistoryLoading } = useAudioHistory(
		isAuthenticated,
		selectedOrganization?.id,
	);
	const { mutate: saveAudioHistory } = useSaveAudioHistory();
	const savedItemIdsRef = useRef<Set<string>>(new Set());
	const pendingSaveRef = useRef<{ localId: string; dbId: string } | null>(null);

	const galleryItems = useMemo<AudioGalleryItem[]>(() => {
		const historical: AudioGalleryItem[] = (historyData?.items ?? []).map(
			(item) => ({
				id: item.id,
				prompt: item.prompt,
				timestamp: new Date(item.createdAt).getTime(),
				voice: item.voice ?? undefined,
				models: item.models.map((m) => ({ ...m, isLoading: false })),
			}),
		);
		return [...activeItems, ...historical];
	}, [activeItems, historyData]);

	const displayItems = useMemo<AudioGalleryItem[]>(() => {
		if (activeItems.length > 0) {
			return activeItems;
		}
		if (selectedItemId) {
			const item = galleryItems.find((i) => i.id === selectedItemId);
			return item ? [item] : [];
		}
		return [];
	}, [activeItems, selectedItemId, galleryItems]);

	// Auto-save completed active items to DB then remove from local state
	useEffect(() => {
		const done = activeItems.filter(
			(item) =>
				item.models.length > 0 &&
				item.models.every((m) => !m.isLoading) &&
				!savedItemIdsRef.current.has(item.id),
		);
		if (done.length === 0) {
			return;
		}
		for (const item of done) {
			savedItemIdsRef.current.add(item.id);
			if (item.models.some((m) => m.audio !== null)) {
				saveAudioHistory(
					{
						body: {
							prompt: item.prompt,
							organizationId: item.organizationId,
							voice: item.voice,
							models: item.models.map((m) => ({
								modelId: m.modelId,
								modelName: m.modelName,
								audio: m.audio,
								error: m.error,
							})),
						},
					},
					{
						onSuccess: (data) => {
							const newId = data.item.id;
							setSelectedItemId(newId);
							const params = new URLSearchParams(window.location.search);
							params.set("id", newId);
							router.replace(`${pathname}?${params.toString()}`, {
								scroll: false,
							});
							pendingSaveRef.current = { localId: item.id, dbId: newId };
						},
						onError: () => {
							savedItemIdsRef.current.delete(item.id);
						},
					},
				);
			} else {
				setActiveItems((prev) => prev.filter((i) => i.id !== item.id));
			}
		}
	}, [activeItems, saveAudioHistory, router, pathname]);

	useEffect(() => {
		const pending = pendingSaveRef.current;
		if (!pending) {
			return;
		}
		const found = historyData?.items.some((i) => i.id === pending.dbId);
		if (found) {
			setActiveItems((prev) => prev.filter((i) => i.id !== pending.localId));
			pendingSaveRef.current = null;
		}
	}, [historyData]);

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	// Ensure playground key
	const pendingRef = useRef(0);
	// Incremented for every generation (and on reset) so finally blocks from
	// requests of an abandoned generation can't decrement the counter of the
	// one currently running.
	const generationIdRef = useRef(0);
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

	// Keep URL in sync with selected model(s)
	useEffect(() => {
		// Read current URL params directly to avoid stale searchParams closure
		// and to prevent an infinite loop where router.replace produces a new
		// searchParams reference that re-triggers this effect (each such cycle
		// causes Next.js to refetch the RSC, re-hitting /orgs forever).
		const currentParams = new URLSearchParams(window.location.search);
		if (comparisonMode) {
			currentParams.set("model", selectedModels.join(","));
			currentParams.set("compare", "1");
		} else {
			const primary = selectedModels[0];
			if (primary) {
				currentParams.set("model", primary);
			} else {
				currentParams.delete("model");
			}
			currentParams.delete("compare");
		}
		const qs = currentParams.toString();
		const nextUrl = `${pathname}${qs ? `?${qs}` : ""}`;
		const currentUrl = `${window.location.pathname}${window.location.search}`;
		if (nextUrl !== currentUrl) {
			router.replace(nextUrl, { scroll: false });
		}
	}, [comparisonMode, pathname, router, selectedModels]);

	useEffect(() => {
		if (selectedModels.length > 0) {
			setModelPreferenceCookie(AUDIO_MODEL_COOKIE, selectedModels.join(","));
		}
	}, [selectedModels]);

	// Sync URL → state for back/forward navigation
	useEffect(() => {
		if (audioIdFromUrl !== selectedItemId) {
			setSelectedItemId(audioIdFromUrl);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [audioIdFromUrl]);

	const restoredItemsRef = useRef<Set<string>>(new Set());

	// Restore compare mode and selected models when loading a history item on page load.
	// Uses a ref to run only once per item ID so history re-fetches don't clobber
	// manual model changes the user makes while viewing a history item.
	useEffect(() => {
		if (!selectedItemId || activeItems.length > 0) {
			return;
		}
		if (restoredItemsRef.current.has(selectedItemId)) {
			return;
		}
		const item = galleryItems.find((i) => i.id === selectedItemId);
		if (!item) {
			return;
		}
		restoredItemsRef.current.add(selectedItemId);
		const isCompare = item.models.length > 1;
		setComparisonMode(isCompare);
		setSelectedModels(item.models.map((m) => m.modelId));
	}, [selectedItemId, activeItems, galleryItems]);

	// Reset voice/format/speed when the selected model changes and the current
	// value isn't valid for the new model. Including the values themselves in
	// deps would clobber the user's explicit selection on every re-render.
	useEffect(() => {
		const primaryModel = selectedModels[0] ?? "";
		const config = getModelAudioConfig(primaryModel);
		if (!config.voices.includes(voice)) {
			setVoice(config.defaultVoice);
		}
		if (!config.availableFormats.includes(audioFormat)) {
			setAudioFormat(config.defaultFormat);
		}
		if (config.supportsSpeed && !config.availableSpeeds.includes(speed)) {
			setSpeed(1);
		}
		if (!config.supportsInstructions) {
			setInstructions("");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedModels]);

	const getModelName = useCallback(
		(modelId: string) => {
			const model = availableModels.find((m) => m.id === modelId);
			return model?.name ?? modelId;
		},
		[availableModels],
	);

	// In the Chat plan context the plan status endpoint is the source of truth
	// for remaining credits; the org row passed from the server can be stale.
	const isChatPlanContext = Boolean(selectedOrganization?.isChat);
	const { data: chatPlanStatus } = api.useQuery(
		"get",
		"/chat-plans/status",
		undefined,
		{ enabled: isChatPlanContext && !!user, staleTime: 30_000 },
	);
	const chatPlanSubscribed = Boolean(
		chatPlanStatus && chatPlanStatus.chatPlan !== "none",
	);

	const generateAudio = useCallback(
		async (overridePrompt?: string | unknown) => {
			const effectivePrompt =
				typeof overridePrompt === "string" ? overridePrompt : prompt;
			if (
				!effectivePrompt.trim() ||
				selectedModels.length === 0 ||
				isGenerating
			) {
				return;
			}

			const currentPrompt = effectivePrompt.trim();
			setIsGenerating(true);
			posthog.capture("playground_audio_generated", {
				models: selectedModels,
				model_count: selectedModels.length,
				comparison_mode: comparisonMode,
				voice,
				response_format: audioFormat,
				speed,
				has_instructions: instructions.trim().length > 0,
			});

			const itemId = crypto.randomUUID();
			const modelsToGenerate = comparisonMode
				? selectedModels
				: selectedModels.slice(0, 1);

			// Create placeholder gallery item
			const placeholderItem: AudioGalleryItem = {
				id: itemId,
				prompt: currentPrompt,
				timestamp: Date.now(),
				organizationId: selectedOrganization?.id,
				voice,
				models: modelsToGenerate.map((modelId) => ({
					modelId,
					modelName: getModelName(modelId),
					audio: null,
					isLoading: true,
				})),
			};

			setActiveItems((prev) => [placeholderItem, ...prev]);
			setSelectedItemId(null);
			setPrompt("");

			// Fire requests independently — each updates gallery as audio arrives.
			const generationId = ++generationIdRef.current;
			pendingRef.current = modelsToGenerate.length;

			for (const modelId of modelsToGenerate) {
				const noFallback = shouldDisableFallback(modelId);
				// Models from different families support different voices, formats
				// and speeds; fall back to each model's defaults when the shared
				// selection isn't valid for it (relevant in comparison mode).
				const config = getModelAudioConfig(modelId);
				const modelVoice = config.voices.includes(voice)
					? voice
					: config.defaultVoice;
				const modelFormat = config.availableFormats.includes(audioFormat)
					? audioFormat
					: config.defaultFormat;
				void (async () => {
					try {
						const response = await fetch("/api/audio", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								...(noFallback ? { "x-no-fallback": "true" } : {}),
							},
							body: JSON.stringify({
								model: modelId,
								input: currentPrompt,
								voice: modelVoice,
								response_format: modelFormat,
								...(config.supportsSpeed &&
								config.availableSpeeds.includes(speed) &&
								speed !== 1
									? { speed }
									: {}),
								...(config.supportsInstructions && instructions.trim()
									? { instructions: instructions.trim() }
									: {}),
							}),
						});

						if (!response.ok) {
							const errorData = await response.json().catch(() => null);
							const rawMessage =
								errorData?.error ??
								`HTTP ${response.status}: ${response.statusText}`;
							throw new Error(
								isChatPlanContext &&
								isInsufficientCreditsError(response.status, rawMessage)
									? chatPlanCreditErrorMessage(chatPlanSubscribed, "audio")
									: rawMessage,
							);
						}

						const data = await response.json();
						const generatedAudio = data.audio as
							| { base64: string; mediaType: string }
							| undefined;

						if (!generatedAudio?.base64) {
							throw new Error(
								"The model did not generate any audio. Try a different model.",
							);
						}

						setActiveItems((prev) =>
							prev.map((item) => {
								if (item.id !== itemId) {
									return item;
								}
								return {
									...item,
									models: item.models.map((m) => {
										if (m.modelId !== modelId) {
											return m;
										}
										return {
											...m,
											audio: generatedAudio,
											isLoading: false,
										};
									}),
								};
							}),
						);
					} catch (error) {
						const errorMessage =
							error instanceof Error
								? error.message
								: "Audio generation failed";
						toast.error(errorMessage);
						setActiveItems((prev) =>
							prev.map((item) => {
								if (item.id !== itemId) {
									return item;
								}
								return {
									...item,
									models: item.models.map((m) => {
										if (m.modelId !== modelId) {
											return m;
										}
										return {
											...m,
											isLoading: false,
											error: errorMessage,
										};
									}),
								};
							}),
						);
					} finally {
						if (generationIdRef.current === generationId) {
							pendingRef.current--;
							if (pendingRef.current === 0) {
								setIsGenerating(false);
							}
						}
					}
				})();
			}
		},
		[
			comparisonMode,
			prompt,
			selectedModels,
			isGenerating,
			getModelName,
			voice,
			audioFormat,
			speed,
			instructions,
			posthog,
			selectedOrganization,
			isChatPlanContext,
			chatPlanSubscribed,
		],
	);

	const handleModelChange = useCallback((index: number, model: string) => {
		setSelectedModels((prev) => {
			const updated = [...prev];
			updated[index] = model;
			return updated;
		});
	}, []);

	const handleAddModel = useCallback(() => {
		if (selectedModels.length >= 3) {
			return;
		}
		const first = audioGenModels[0];
		setSelectedModels((prev) => [...prev, first?.id ?? ""]);
	}, [selectedModels.length, audioGenModels]);

	const handleRemoveModel = useCallback((index: number) => {
		setSelectedModels((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleComparisonModeChange = useCallback(
		(enabled: boolean) => {
			setComparisonMode(enabled);
			if (enabled && selectedModels.length < 2) {
				const second = audioGenModels[1] ?? audioGenModels[0];
				if (second) {
					setSelectedModels((prev) => [...prev, second.id]);
				}
			} else if (!enabled) {
				setSelectedModels((prev) => prev.slice(0, 1));
			}
		},
		[selectedModels.length, audioGenModels],
	);

	const handleSuggestionClick = useCallback(
		(suggestion: string) => {
			setPrompt(suggestion);
			void generateAudio(suggestion);
		},
		[generateAudio],
	);

	const handleNewChat = useCallback(() => {
		setActiveItems([]);
		setSelectedItemId(null);
		setPrompt("");
		setInstructions("");
		setIsGenerating(false);
		setComparisonMode(false);
		generationIdRef.current++;
		pendingRef.current = 0;
		const params = new URLSearchParams(window.location.search);
		params.delete("id");
		const qs = params.toString();
		router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
	}, [pathname, router]);

	const handleItemClick = useCallback(
		(itemId: string) => {
			if (activeItems.length > 0) {
				return;
			}
			setSelectedItemId(itemId);
			const item = galleryItems.find((i) => i.id === itemId);
			if (item) {
				restoredItemsRef.current.add(itemId);
				const isCompare = item.models.length > 1;
				setComparisonMode(isCompare);
				setSelectedModels(item.models.map((m) => m.modelId));
			}
			const params = new URLSearchParams(window.location.search);
			params.set("id", itemId);
			if (item && item.models.length > 1) {
				params.set("compare", "1");
			} else {
				params.delete("compare");
			}
			router.push(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[activeItems, galleryItems, pathname, router],
	);

	const chatPlanCreditsRemaining =
		chatPlanStatus && chatPlanStatus.chatPlan !== "none"
			? Number(chatPlanStatus.chatPlanCreditsRemaining)
			: 0;
	const isLowCredits = selectedOrganization
		? isChatPlanContext
			? chatPlanStatus !== undefined &&
				Number(chatPlanStatus.regularCredits) + chatPlanCreditsRemaining < 1
			: Number(selectedOrganization.credits) < 1
		: false;
	// In the Chat plan context an out-of-credits state upsells the plans inline
	// instead of a top-up banner.
	const showPlanUpsell = isChatPlanContext && isLowCredits;

	const handleSelectOrganization = useCallback(
		(org: Organization | null) => {
			const params = new URLSearchParams(Array.from(searchParams.entries()));
			if (org?.id) {
				params.set("orgId", org.id);
			} else {
				params.delete("orgId");
			}
			params.delete("projectId");
			router.push(params.toString() ? `/audio?${params.toString()}` : "/audio");
		},
		[router, searchParams],
	);

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<AudioSidebar
					galleryItems={galleryItems}
					isHistoryLoading={isHistoryLoading}
					onNewChat={handleNewChat}
					onItemClick={handleItemClick}
					organizations={organizations}
					selectedOrganization={selectedOrganization}
					onSelectOrganization={handleSelectOrganization}
					currentItemId={selectedItemId}
				/>
				<div className="flex flex-1 flex-col min-w-0">
					<AudioHeader
						models={audioGenModels}
						providers={providers}
						selectedModels={selectedModels}
						onModelChange={handleModelChange}
						onAddModel={handleAddModel}
						onRemoveModel={handleRemoveModel}
						comparisonMode={comparisonMode}
						onComparisonModeChange={handleComparisonModeChange}
						hideCompare={displayItems.length > 0}
					/>
					{isLowCredits && !isChatPlanContext && (
						<div className="bg-yellow-50 dark:bg-yellow-900/20 border-b px-4 py-2 flex items-center justify-between">
							<p className="text-sm text-yellow-800 dark:text-yellow-200">
								Low credits remaining. Top up to continue generating audio.
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowTopUp(true)}
							>
								Top Up
							</Button>
						</div>
					)}
					<AudioControls
						prompt={prompt}
						setPrompt={setPrompt}
						selectedModels={selectedModels}
						voice={voice}
						setVoice={setVoice}
						audioFormat={audioFormat}
						setAudioFormat={setAudioFormat}
						speed={speed}
						setSpeed={setSpeed}
						instructions={instructions}
						setInstructions={setInstructions}
						isGenerating={isGenerating}
						onGenerate={generateAudio}
					/>
					<div className="flex-1 overflow-y-auto p-4">
						{showPlanUpsell ? (
							<ChatPlanUpsell
								noun="audio"
								isAuthenticated={!!user}
								subscribed={chatPlanSubscribed}
							/>
						) : (
							<div className="max-w-6xl mx-auto">
								<AudioGallery
									items={displayItems}
									comparisonMode={comparisonMode}
									onSuggestionClick={handleSuggestionClick}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
			<AuthDialog open={showAuthDialog} returnUrl={returnUrl} />
			<TopUpCreditsDialog
				open={showTopUp}
				onOpenChange={setShowTopUp}
				organizationId={selectedOrganization?.id}
			/>
		</SidebarProvider>
	);
}
