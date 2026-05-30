"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { VideoControls } from "@/components/playground/video-controls";
import { VideoGallery } from "@/components/playground/video-gallery";
import { VideoHeader } from "@/components/playground/video-header";
import { VideoSidebar } from "@/components/playground/video-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
	useSaveVideoHistory,
	useVideoHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { useFetchClient } from "@/lib/fetch-client";
import { mapModels } from "@/lib/mapmodels";
import {
	getModelPreferenceCookie,
	setModelPreferenceCookie,
	VIDEO_MODEL_COOKIE,
} from "@/lib/model-preferences";
import { shouldDisableFallback } from "@/lib/no-fallback";
import {
	getNormalizedVideoRequestSelection,
	getSupportedVideoRequestOptions,
	pollVideoJob,
	supportsVideoFrameInput,
	supportsVideoReferenceInput,
} from "@/lib/video-gen";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { ComboboxModel, Organization, Project } from "@/lib/types";
import type {
	VideoDuration,
	VideoFrameInputs,
	VideoGalleryItem,
	VideoInputImage,
	VideoJob,
	VideoSize,
} from "@/lib/video-gen";

interface VideoPageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialModelPreference?: string | null;
}

export default function VideoPageClient({
	models,
	providers,
	organizations: _organizations,
	selectedOrganization,
	projects: _projects,
	selectedProject,
	initialModelPreference,
}: VideoPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const posthog = usePostHog();
	const fetchClient = useFetchClient();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	const videoGenModels = useMemo(() => {
		const now = new Date();
		return models.filter((m) => {
			if (!m.output?.includes("video")) {
				return false;
			}
			return m.mappings.some(
				(mapping) =>
					!mapping.deactivatedAt || new Date(mapping.deactivatedAt) > now,
			);
		});
	}, [models]);

	const mapped = useMemo(
		() => mapModels(videoGenModels, providers),
		[videoGenModels, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	const [selectedModels, setSelectedModels] = useState<string[]>(() => {
		const modelParam = searchParams.get("model");
		if (modelParam) {
			const models = modelParam.split(",").filter(Boolean);
			if (models.length > 0) {
				return models;
			}
		}
		const stored =
			getModelPreferenceCookie(VIDEO_MODEL_COOKIE) ?? initialModelPreference;
		if (stored) {
			const models = stored.split(",").filter(Boolean);
			if (models.length > 0) {
				return models;
			}
		}
		const first = videoGenModels[0];
		return first ? [first.id] : [];
	});
	const [comparisonMode, setComparisonMode] = useState(
		() => searchParams.get("compare") === "1",
	);
	const [prompt, setPrompt] = useState("");
	const [activeItems, setActiveItems] = useState<VideoGalleryItem[]>([]);
	const videoIdFromUrl = searchParams.get("id");
	const [selectedItemId, setSelectedItemId] = useState<string | null>(
		videoIdFromUrl,
	);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showTopUp, setShowTopUp] = useState(false);

	const [videoSize, setVideoSize] = useState<VideoSize>("1280x720");
	const [videoDuration, setVideoDuration] = useState<VideoDuration>(8);
	const [audioEnabled, setAudioEnabled] = useState(true);
	const [frameInputs, setFrameInputs] = useState<VideoFrameInputs>({
		start: null,
		end: null,
	});
	const [referenceImages, setReferenceImages] = useState<VideoInputImage[]>([]);
	const availableModelsById = useMemo(
		() => new Map(availableModels.map((model) => [model.id, model])),
		[availableModels],
	);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	// DB-persisted history
	const { data: historyData } = useVideoHistory(isAuthenticated);
	const { mutate: saveVideoHistory } = useSaveVideoHistory();
	const savedItemIdsRef = useRef<Set<string>>(new Set());
	const pendingSaveRef = useRef<{ localId: string; dbId: string } | null>(null);

	const galleryItems = useMemo<VideoGalleryItem[]>(() => {
		const historical: VideoGalleryItem[] = (historyData?.items ?? []).map(
			(item) => ({
				id: item.id,
				prompt: item.prompt,
				timestamp: new Date(item.createdAt).getTime(),
				frameInputs: item.frameInputs ?? undefined,
				referenceImages: item.referenceImages ?? undefined,
				models: item.models.map((m) => ({
					modelId: m.modelId,
					modelName: m.modelName,
					job: null,
					videoUrl: m.videoUrl,
					expiresAt: m.expiresAt ?? null,
					error: m.error,
					isLoading: false,
				})),
			}),
		);
		return [...activeItems, ...historical];
	}, [activeItems, historyData]);

	const displayItems = useMemo<VideoGalleryItem[]>(() => {
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
			if (item.models.some((m) => m.videoUrl !== null)) {
				saveVideoHistory(
					{
						body: {
							prompt: item.prompt,
							frameInputs: item.frameInputs,
							referenceImages: item.referenceImages,
							models: item.models.map((m) => ({
								modelId: m.modelId,
								modelName: m.modelName,
								jobId: m.job?.id ?? null,
								videoUrl: m.videoUrl,
								expiresAt: m.expiresAt ?? null,
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
	}, [activeItems, saveVideoHistory, router, pathname]);

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

	const canUseFrameInputs = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) => supportsVideoFrameInput(modelId)),
		[selectedModels],
	);
	const canUseReferenceInputs = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) => supportsVideoReferenceInput(modelId)),
		[selectedModels],
	);
	const requiresAudioSelection = useMemo(
		() =>
			selectedModels.some(
				(modelId) =>
					modelId.includes("/") && !modelId.startsWith("google-vertex/"),
			),
		[selectedModels],
	);
	const effectiveAudioEnabled = requiresAudioSelection ? true : audioEnabled;

	useEffect(() => {
		if (requiresAudioSelection && !audioEnabled) {
			setAudioEnabled(true);
		}
	}, [audioEnabled, requiresAudioSelection]);

	const supportsSelectedAudioMode = useCallback(
		(modelId: string, withAudio: boolean) => {
			if (!modelId.includes("/")) {
				return true;
			}

			const model = availableModelsById.get(modelId);
			if (!model) {
				return true;
			}

			return withAudio
				? model.supportsVideoAudio !== false
				: model.supportsVideoWithoutAudio === true;
		},
		[availableModelsById],
	);
	const isModelOptionDisabled = useCallback(
		(modelId: string) =>
			!supportsSelectedAudioMode(modelId, effectiveAudioEnabled),
		[effectiveAudioEnabled, supportsSelectedAudioMode],
	);
	const getModelOptionDisabledReason = useCallback(
		(modelId: string) => {
			if (!isModelOptionDisabled(modelId)) {
				return undefined;
			}

			return effectiveAudioEnabled
				? "This mapping does not support audio output"
				: "This mapping does not support silent output";
		},
		[effectiveAudioEnabled, isModelOptionDisabled],
	);

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	const pendingRef = useRef(0);
	const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
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

	// Cleanup abort controllers on unmount
	useEffect(() => {
		const abortControllers = abortControllersRef.current;
		return () => {
			Array.from(abortControllers.values()).forEach((controller) => {
				controller.abort();
			});
		};
	}, []);

	// Sync URL → state for back/forward navigation
	useEffect(() => {
		if (videoIdFromUrl !== selectedItemId) {
			setSelectedItemId(videoIdFromUrl);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [videoIdFromUrl]);

	const lastRestoredIdRef = useRef<string | null>(null);

	// Restore compare mode and selected models when loading a history item on page load.
	// Uses a ref to run only once per item ID so history re-fetches don't clobber
	// manual model changes the user makes while viewing a history item.
	useEffect(() => {
		if (!selectedItemId || activeItems.length > 0) {
			return;
		}
		if (lastRestoredIdRef.current === selectedItemId) {
			return;
		}
		const item = galleryItems.find((i) => i.id === selectedItemId);
		if (!item) {
			return;
		}
		lastRestoredIdRef.current = selectedItemId;
		const isCompare = item.models.length > 1;
		setComparisonMode(isCompare);
		setSelectedModels(item.models.map((m) => m.modelId));
	}, [selectedItemId, galleryItems]);

	useEffect(() => {
		if (!canUseFrameInputs) {
			setFrameInputs({
				start: null,
				end: null,
			});
		}
		if (!canUseReferenceInputs) {
			setReferenceImages([]);
		}
	}, [canUseFrameInputs, canUseReferenceInputs]);

	const videoInputMode = useMemo(() => {
		if (referenceImages.length > 0) {
			return "reference" as const;
		}

		if (frameInputs.start || frameInputs.end) {
			return "frames" as const;
		}

		return "none" as const;
	}, [frameInputs.end, frameInputs.start, referenceImages.length]);

	const supportedVideoRequestOptions = useMemo(
		() =>
			getSupportedVideoRequestOptions(
				videoGenModels,
				selectedModels,
				videoInputMode,
				effectiveAudioEnabled,
			),
		[effectiveAudioEnabled, selectedModels, videoGenModels, videoInputMode],
	);

	useEffect(() => {
		if (selectedModels.length === 0) {
			return;
		}

		const normalizedSelection = getNormalizedVideoRequestSelection(
			videoGenModels,
			selectedModels,
			videoInputMode,
			effectiveAudioEnabled,
			videoSize,
			videoDuration,
		);

		if (!normalizedSelection) {
			return;
		}

		if (normalizedSelection.size !== videoSize) {
			setVideoSize(normalizedSelection.size);
		}

		if (normalizedSelection.duration !== videoDuration) {
			setVideoDuration(normalizedSelection.duration);
		}
	}, [
		effectiveAudioEnabled,
		selectedModels,
		videoDuration,
		videoGenModels,
		videoInputMode,
		videoSize,
	]);

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
			setModelPreferenceCookie(VIDEO_MODEL_COOKIE, selectedModels.join(","));
		}
	}, [selectedModels]);

	const getModelName = useCallback(
		(modelId: string) => {
			const model = availableModels.find((m) => m.id === modelId);
			return model?.name ?? modelId;
		},
		[availableModels],
	);

	const updateGalleryModel = useCallback(
		(
			itemId: string,
			modelId: string,
			updates: Partial<VideoGalleryItem["models"][number]>,
		) => {
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
							return { ...m, ...updates };
						}),
					};
				}),
			);
		},
		[],
	);

	const generateVideos = useCallback(
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
			posthog.capture("playground_video_generated", {
				models: selectedModels,
				model_count: selectedModels.length,
				comparison_mode: comparisonMode,
				video_size: videoSize,
				video_duration: videoDuration,
				audio_enabled: effectiveAudioEnabled,
				has_frame_inputs: !!(frameInputs.start ?? frameInputs.end),
				has_reference_images: referenceImages.length > 0,
			});

			const itemId = crypto.randomUUID();

			const placeholderItem: VideoGalleryItem = {
				id: itemId,
				prompt: currentPrompt,
				timestamp: Date.now(),
				frameInputs:
					frameInputs.start || frameInputs.end ? { ...frameInputs } : undefined,
				referenceImages:
					referenceImages.length > 0 ? [...referenceImages] : undefined,
				models: selectedModels.map((modelId) => ({
					modelId,
					modelName: getModelName(modelId),
					job: null,
					videoUrl: null,
					expiresAt: null,
					isLoading: true,
				})),
			};

			setActiveItems((prev) => [placeholderItem, ...prev]);
			setSelectedItemId(null);
			setPrompt("");
			setFrameInputs({
				start: null,
				end: null,
			});
			setReferenceImages([]);

			pendingRef.current = selectedModels.length;

			for (const modelId of selectedModels) {
				const noFallback = shouldDisableFallback(modelId);
				const controllerKey = `${itemId}-${modelId}`;
				const controller = new AbortController();
				abortControllersRef.current.set(controllerKey, controller);

				void (async () => {
					try {
						const response = await fetch("/api/video", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								...(noFallback ? { "x-no-fallback": "true" } : {}),
							},
							body: JSON.stringify({
								model: modelId,
								prompt: currentPrompt,
								size: videoSize,
								seconds: videoDuration,
								audio: effectiveAudioEnabled,
								...(referenceImages.length === 0 && frameInputs.start
									? {
											image: {
												image_url: frameInputs.start.dataUrl,
											},
										}
									: {}),
								...(referenceImages.length === 0 && frameInputs.end
									? {
											last_frame: {
												image_url: frameInputs.end.dataUrl,
											},
										}
									: {}),
								...(referenceImages.length > 0
									? {
											reference_images: referenceImages.map((image) => ({
												image_url: image.dataUrl,
											})),
										}
									: {}),
							}),
							signal: controller.signal,
						});

						if (!response.ok) {
							const errorData = await response.json().catch(() => null);
							throw new Error(
								errorData?.error ??
									`HTTP ${response.status}: ${response.statusText}`,
							);
						}

						const job: VideoJob = await response.json();

						updateGalleryModel(itemId, modelId, {
							job,
							isLoading: true,
						});

						for await (const updatedJob of pollVideoJob(
							job.id,
							fetchClient,
							controller.signal,
						)) {
							if (updatedJob.status === "completed") {
								const videoUrl = `/api/video/${updatedJob.id}/content`;
								updateGalleryModel(itemId, modelId, {
									job: updatedJob,
									videoUrl,
									expiresAt: updatedJob.expires_at ?? null,
									isLoading: false,
								});
							} else if (
								updatedJob.status === "failed" ||
								updatedJob.status === "canceled" ||
								updatedJob.status === "expired"
							) {
								updateGalleryModel(itemId, modelId, {
									job: updatedJob,
									error: updatedJob.error?.message ?? "Video generation failed",
									isLoading: false,
								});
							} else {
								updateGalleryModel(itemId, modelId, {
									job: updatedJob,
								});
							}
						}
					} catch (error) {
						if (error instanceof DOMException && error.name === "AbortError") {
							return;
						}
						const errorMessage =
							error instanceof Error
								? error.message
								: "Video generation failed";
						toast.error(errorMessage);
						updateGalleryModel(itemId, modelId, {
							isLoading: false,
							error: errorMessage,
						});
					} finally {
						abortControllersRef.current.delete(controllerKey);
						pendingRef.current--;
						if (pendingRef.current === 0) {
							setIsGenerating(false);
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
			fetchClient,
			videoSize,
			videoDuration,
			effectiveAudioEnabled,
			frameInputs,
			posthog,
			referenceImages,
			updateGalleryModel,
			pathname,
			router,
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
		const first = videoGenModels[0];
		setSelectedModels((prev) => [...prev, first?.id ?? ""]);
	}, [selectedModels.length, videoGenModels]);

	const handleRemoveModel = useCallback((index: number) => {
		setSelectedModels((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleComparisonModeChange = useCallback(
		(enabled: boolean) => {
			setComparisonMode(enabled);
			if (enabled && selectedModels.length < 2) {
				const second = videoGenModels[1] ?? videoGenModels[0];
				if (second) {
					setSelectedModels((prev) => [...prev, second.id]);
				}
			} else if (!enabled) {
				setSelectedModels((prev) => prev.slice(0, 1));
			}
		},
		[selectedModels.length, videoGenModels],
	);

	const handleSuggestionClick = useCallback(
		(suggestion: string) => {
			setPrompt(suggestion);
			void generateVideos(suggestion);
		},
		[generateVideos],
	);

	const handleNewChat = useCallback(() => {
		Array.from(abortControllersRef.current.values()).forEach((controller) => {
			controller.abort();
		});
		abortControllersRef.current.clear();
		setActiveItems([]);
		setSelectedItemId(null);
		setPrompt("");
		setFrameInputs({ start: null, end: null });
		setReferenceImages([]);
		setIsGenerating(false);
		pendingRef.current = 0;
		const params = new URLSearchParams(window.location.search);
		params.delete("id");
		const qs = params.toString();
		router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
	}, [pathname, router]);

	const handleItemClick = useCallback(
		(itemId: string) => {
			setSelectedItemId(itemId);
			// Don't overwrite model/compare state while a generation is in progress —
			// the gallery still shows activeItems and the next run should use the
			// current header selection, not the clicked history item's models.
			if (activeItems.length === 0) {
				const item = galleryItems.find((i) => i.id === itemId);
				if (item) {
					lastRestoredIdRef.current = itemId;
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
			}
		},
		[activeItems, galleryItems, pathname, router],
	);

	const isLowCredits = selectedOrganization
		? Number(selectedOrganization.credits) < 1
		: false;

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<VideoSidebar
					galleryItems={galleryItems}
					onNewChat={handleNewChat}
					onItemClick={handleItemClick}
					selectedOrganization={selectedOrganization}
					currentItemId={selectedItemId}
				/>
				<div className="flex flex-1 flex-col min-w-0">
					<VideoHeader
						models={videoGenModels}
						providers={providers}
						selectedModels={selectedModels}
						onModelChange={handleModelChange}
						onAddModel={handleAddModel}
						onRemoveModel={handleRemoveModel}
						comparisonMode={comparisonMode}
						onComparisonModeChange={handleComparisonModeChange}
						isModelOptionDisabled={isModelOptionDisabled}
						getModelOptionDisabledReason={getModelOptionDisabledReason}
						hideCompare={displayItems.length > 0}
					/>
					{isLowCredits && (
						<div className="bg-yellow-50 dark:bg-yellow-900/20 border-b px-4 py-2 flex items-center justify-between">
							<p className="text-sm text-yellow-800 dark:text-yellow-200">
								Low credits remaining. Top up to continue generating videos.
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
					<VideoControls
						prompt={prompt}
						setPrompt={setPrompt}
						selectedModels={selectedModels}
						videoSize={videoSize}
						setVideoSize={setVideoSize}
						videoDuration={videoDuration}
						setVideoDuration={setVideoDuration}
						audioEnabled={effectiveAudioEnabled}
						setAudioEnabled={setAudioEnabled}
						audioToggleDisabled={isGenerating || requiresAudioSelection}
						canUseFrameInputs={canUseFrameInputs}
						canUseReferenceInputs={canUseReferenceInputs}
						frameInputs={frameInputs}
						setFrameInputs={setFrameInputs}
						referenceImages={referenceImages}
						setReferenceImages={setReferenceImages}
						supportedVideoSizes={supportedVideoRequestOptions.sizes}
						supportedVideoDurations={supportedVideoRequestOptions.durations}
						isGenerating={isGenerating}
						onGenerate={generateVideos}
					/>
					<div className="flex-1 overflow-y-auto p-4">
						<div className="max-w-6xl mx-auto">
							<VideoGallery
								items={displayItems}
								comparisonMode={comparisonMode}
								onSuggestionClick={handleSuggestionClick}
							/>
						</div>
					</div>
				</div>
			</div>
			<AuthDialog open={showAuthDialog} returnUrl={returnUrl} />
			<TopUpCreditsDialog open={showTopUp} onOpenChange={setShowTopUp} />
		</SidebarProvider>
	);
}
