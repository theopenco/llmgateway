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
import { ChatPlanUpsell } from "@/components/pricing/chat-plan-upsell";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
	useSaveVideoHistory,
	useVideoHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { useAppConfig } from "@/lib/config";
import {
	chatPlanCreditErrorMessage,
	isInsufficientCreditsError,
} from "@/lib/credit-error";
import { useApi, useFetchClient } from "@/lib/fetch-client";
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
	supportsVideoReferenceVideoInput,
	supportsVideoReferenceAudioInput,
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
	organizations,
	selectedOrganization,
	projects: _projects,
	selectedProject,
	initialModelPreference,
}: VideoPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const posthog = usePostHog();
	const config = useAppConfig();
	const fetchClient = useFetchClient();
	const api = useApi();
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
	const [referenceVideos, setReferenceVideos] = useState<string[]>([]);
	const [referenceAudios, setReferenceAudios] = useState<string[]>([]);
	const availableModelsById = useMemo(
		() => new Map(availableModels.map((model) => [model.id, model])),
		[availableModels],
	);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	// DB-persisted history
	const { data: historyData, isLoading: isHistoryLoading } = useVideoHistory(
		isAuthenticated,
		selectedOrganization?.id,
	);
	const { mutate: saveVideoHistory } = useSaveVideoHistory();
	const savedItemIdsRef = useRef<Set<string>>(new Set());
	const pendingSaveRef = useRef<{ localId: string; dbId: string } | null>(null);

	// The history list carries no base64 input images, only presence flags.
	// Previews are lazily loaded binary endpoints, indexed in the same
	// [start, end, ...references] order the API serves them in.
	const galleryItems = useMemo<VideoGalleryItem[]>(() => {
		const historical: VideoGalleryItem[] = (historyData?.items ?? []).map(
			(item) => {
				const inputPreviews: { src: string; label: string }[] = [];
				const inputImageUrl = (index: number) =>
					`${config.apiUrl}/playground/video-history/${item.id}/input-image/${index}`;
				if (item.hasStartFrame) {
					inputPreviews.push({
						src: inputImageUrl(inputPreviews.length),
						label: "First frame",
					});
				}
				if (item.hasEndFrame) {
					inputPreviews.push({
						src: inputImageUrl(inputPreviews.length),
						label: "Last frame",
					});
				}
				for (let i = 0; i < item.referenceImageCount; i++) {
					inputPreviews.push({
						src: inputImageUrl(inputPreviews.length),
						label: `Reference ${i + 1}`,
					});
				}
				return {
					id: item.id,
					prompt: item.prompt,
					timestamp: new Date(item.createdAt).getTime(),
					inputPreviews,
					models: item.models.map((m) => ({
						modelId: m.modelId,
						modelName: m.modelName,
						job: null,
						videoUrl: m.videoUrl,
						expiresAt: m.expiresAt ?? null,
						error: m.error,
						isLoading: false,
					})),
				};
			},
		);
		return [...activeItems, ...historical];
	}, [activeItems, historyData, config.apiUrl]);

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
							organizationId: item.organizationId,
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
	const canUseReferenceVideoInputs = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) =>
				supportsVideoReferenceVideoInput(modelId),
			),
		[selectedModels],
	);
	const canUseReferenceAudioInputs = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) =>
				supportsVideoReferenceAudioInput(modelId),
			),
		[selectedModels],
	);
	const someModelsRequireImage = useMemo(
		() =>
			selectedModels.some((modelId) => {
				const model = availableModelsById.get(modelId);
				return model?.imageInputRequired === true;
			}),
		[selectedModels, availableModelsById],
	);
	// The audio toggle is a preference, never a selection constraint: any model
	// stays selectable, models that only support one audio mode get clamped per
	// request in generateVideos, and the toggle locks unless every selected
	// model supports both modes (otherwise flipping it wouldn't apply to the
	// whole selection).
	const selectionAudioSupport = useMemo(() => {
		const selected = selectedModels
			.map((modelId) => availableModelsById.get(modelId))
			.filter((model): model is ComboboxModel => Boolean(model));
		if (selected.length === 0) {
			return { audio: true, silent: true };
		}
		return {
			audio: selected.every((model) => model.supportsVideoAudio !== false),
			silent: selected.every(
				(model) => model.supportsVideoWithoutAudio === true,
			),
		};
	}, [selectedModels, availableModelsById]);
	const audioToggleLocked =
		!selectionAudioSupport.audio || !selectionAudioSupport.silent;
	const effectiveAudioEnabled = !selectionAudioSupport.audio
		? false
		: !selectionAudioSupport.silent
			? true
			: audioEnabled;
	const audioToggleLockedReason = !selectionAudioSupport.audio
		? selectionAudioSupport.silent
			? "The selected model only generates silent video"
			: "Audio output is fixed by each selected model"
		: !selectionAudioSupport.silent
			? "The selected model always generates video with audio"
			: undefined;

	const getAudioForModel = useCallback(
		(modelId: string) => {
			const model = availableModelsById.get(modelId);
			if (!model) {
				return effectiveAudioEnabled;
			}
			if (model.supportsVideoAudio === false) {
				return false;
			}
			if (model.supportsVideoWithoutAudio !== true) {
				return true;
			}
			return effectiveAudioEnabled;
		},
		[availableModelsById, effectiveAudioEnabled],
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
	}, [selectedItemId, galleryItems, activeItems.length]);

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
		if (!canUseReferenceVideoInputs) {
			setReferenceVideos([]);
		}
		if (!canUseReferenceAudioInputs) {
			setReferenceAudios([]);
		}
	}, [
		canUseFrameInputs,
		canUseReferenceInputs,
		canUseReferenceVideoInputs,
		canUseReferenceAudioInputs,
	]);

	const videoInputMode = useMemo(() => {
		if (
			referenceImages.length > 0 ||
			referenceVideos.length > 0 ||
			referenceAudios.length > 0
		) {
			return "reference" as const;
		}

		if (frameInputs.start || frameInputs.end) {
			return "frames" as const;
		}

		return "none" as const;
	}, [
		frameInputs.end,
		frameInputs.start,
		referenceImages.length,
		referenceVideos.length,
		referenceAudios.length,
	]);

	const supportedVideoRequestOptions = useMemo(
		() =>
			getSupportedVideoRequestOptions(
				videoGenModels,
				selectedModels,
				videoInputMode,
			),
		[selectedModels, videoGenModels, videoInputMode],
	);

	useEffect(() => {
		if (selectedModels.length === 0) {
			return;
		}

		const normalizedSelection = getNormalizedVideoRequestSelection(
			videoGenModels,
			selectedModels,
			videoInputMode,
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

			if (someModelsRequireImage && !frameInputs.start) {
				toast.error(
					"Selected model requires an input image. Please add a start frame.",
				);
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
				has_reference_videos: referenceVideos.length > 0,
				has_reference_audios: referenceAudios.length > 0,
			});

			const itemId = crypto.randomUUID();
			const modelsToGenerate = comparisonMode
				? selectedModels
				: selectedModels.slice(0, 1);

			const placeholderItem: VideoGalleryItem = {
				id: itemId,
				prompt: currentPrompt,
				timestamp: Date.now(),
				organizationId: selectedOrganization?.id,
				frameInputs:
					frameInputs.start || frameInputs.end ? { ...frameInputs } : undefined,
				referenceImages:
					referenceImages.length > 0 ? [...referenceImages] : undefined,
				inputPreviews: [
					...(frameInputs.start
						? [{ src: frameInputs.start.dataUrl, label: "First frame" }]
						: []),
					...(frameInputs.end
						? [{ src: frameInputs.end.dataUrl, label: "Last frame" }]
						: []),
					...referenceImages.map((ref, i) => ({
						src: ref.dataUrl,
						label: `Reference ${i + 1}`,
					})),
				],
				models: modelsToGenerate.map((modelId) => ({
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
			setReferenceVideos([]);
			setReferenceAudios([]);

			pendingRef.current = modelsToGenerate.length;

			for (const modelId of modelsToGenerate) {
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
								audio: getAudioForModel(modelId),
								...(referenceImages.length === 0 &&
								referenceVideos.length === 0 &&
								referenceAudios.length === 0 &&
								frameInputs.start
									? {
											image: {
												image_url: frameInputs.start.dataUrl,
											},
										}
									: {}),
								...(referenceImages.length === 0 &&
								referenceVideos.length === 0 &&
								referenceAudios.length === 0 &&
								frameInputs.end
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
								...(referenceVideos.length > 0
									? {
											reference_videos: referenceVideos,
										}
									: {}),
								...(referenceAudios.length > 0
									? {
											reference_audios: referenceAudios,
										}
									: {}),
							}),
							signal: controller.signal,
						});

						if (!response.ok) {
							const errorData = await response.json().catch(() => null);
							const rawMessage =
								errorData?.error ??
								`HTTP ${response.status}: ${response.statusText}`;
							throw new Error(
								isChatPlanContext &&
								isInsufficientCreditsError(response.status, rawMessage)
									? chatPlanCreditErrorMessage(chatPlanSubscribed, "videos")
									: rawMessage,
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
			getAudioForModel,
			frameInputs,
			posthog,
			referenceImages,
			referenceVideos,
			referenceAudios,
			updateGalleryModel,
			someModelsRequireImage,
			selectedOrganization?.id,
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
		setReferenceVideos([]);
		setReferenceAudios([]);
		setIsGenerating(false);
		setComparisonMode(false);
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
			router.push(params.toString() ? `/video?${params.toString()}` : "/video");
		},
		[router, searchParams],
	);

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<VideoSidebar
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
					<VideoHeader
						models={videoGenModels}
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
						audioToggleDisabled={isGenerating || audioToggleLocked}
						audioToggleDisabledReason={audioToggleLockedReason}
						canUseFrameInputs={canUseFrameInputs}
						canUseReferenceInputs={canUseReferenceInputs}
						canUseReferenceVideoInputs={canUseReferenceVideoInputs}
						canUseReferenceAudioInputs={canUseReferenceAudioInputs}
						frameInputs={frameInputs}
						setFrameInputs={setFrameInputs}
						referenceImages={referenceImages}
						setReferenceImages={setReferenceImages}
						referenceVideos={referenceVideos}
						setReferenceVideos={setReferenceVideos}
						referenceAudios={referenceAudios}
						setReferenceAudios={setReferenceAudios}
						supportedVideoSizes={supportedVideoRequestOptions.sizes}
						supportedVideoDurations={supportedVideoRequestOptions.durations}
						isGenerating={isGenerating}
						onGenerate={generateVideos}
						imageInputRequired={someModelsRequireImage}
					/>
					<div className="flex-1 overflow-y-auto p-4">
						{showPlanUpsell ? (
							<ChatPlanUpsell
								noun="videos"
								isAuthenticated={!!user}
								subscribed={chatPlanSubscribed}
							/>
						) : (
							<div className="max-w-6xl mx-auto">
								<VideoGallery
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
