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
	useUpdateVideoHistory,
	useVideoHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { useAppConfig } from "@/lib/config";
import {
	chatPlanCreditErrorMessage,
	isInsufficientCreditsError,
	organizationCreditErrorMessage,
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
	estimateVideoSelectionCostUsd,
	findVideoSize,
	getNormalizedVideoRequestSelection,
	getSupportedVideoDurationsForSelection,
	getSupportedVideoRequestOptions,
	getSupportedVideoSizesForSelection,
	getVideoOrientation,
	getVideoResolution,
	isPendingVideoModel,
	POLL_TIMEOUT_ERROR_CODE,
	pollVideoJob,
	supportsVideoEndFrameInput,
	supportsVideoFrameInput,
	supportsVideoReferenceInput,
	supportsVideoReferenceVideoInput,
	supportsVideoReferenceAudioInput,
	videoContentUrl,
	VideoPollError,
} from "@/lib/video-gen";

import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

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

interface SavedVideoModelResult {
	modelId: string;
	modelName: string;
	jobId: string | null;
	videoUrl: string | null;
	expiresAt?: number | null;
	error?: string;
}

// The saved outcome of a terminal job. Null while it is still running, and
// also when only this page's poll gave up: the job itself may still finish,
// so the saved row stays pending and the next page load resumes it.
function savedResultForJob(
	job: VideoJob,
): Partial<
	Pick<SavedVideoModelResult, "videoUrl" | "expiresAt" | "error">
> | null {
	if (job.status === "completed") {
		return {
			videoUrl: videoContentUrl(job.id),
			expiresAt: job.expires_at ?? null,
		};
	}
	if (job.status === "failed" && job.error?.code === POLL_TIMEOUT_ERROR_CODE) {
		return null;
	}
	if (
		job.status === "failed" ||
		job.status === "canceled" ||
		job.status === "expired"
	) {
		return { error: job.error?.message ?? "Video generation failed" };
	}
	return null;
}

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
	const { mutateAsync: saveVideoHistory } = useSaveVideoHistory();
	const { mutateAsync: updateVideoHistory } = useUpdateVideoHistory();
	// In-flight items are saved at submission; this maps each local id to its
	// saved row so the row's copy stays hidden until the local one is done.
	const [dbIdByLocalId, setDbIdByLocalId] = useState<Map<string, string>>(
		() => new Map(),
	);
	// Saved rows whose still-running jobs this page already resumed polling.
	const resumedItemIdsRef = useRef<Set<string>>(new Set());
	const resumeControllersRef = useRef<Map<string, AbortController>>(new Map());

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
						isLoading: isPendingVideoModel(m),
					})),
				};
			},
		);
		const hiddenIds = new Set(dbIdByLocalId.values());
		return [
			...activeItems,
			...historical.filter((item) => !hiddenIds.has(item.id)),
		];
	}, [activeItems, dbIdByLocalId, historyData, config.apiUrl]);

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

	const canUseFrameInputs = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) => supportsVideoFrameInput(modelId)),
		[selectedModels],
	);
	const canUseEndFrameInputs = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) => supportsVideoEndFrameInput(modelId)),
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
	// One token per generation run; "New chat" marks them canceled so a run
	// whose requests settle later leaves the new page state alone.
	const runsRef = useRef<Set<{ canceled: boolean }>>(new Set());
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

	// Cleanup abort controllers on unmount. Runs are canceled first so a save
	// that completes after leaving the page cannot update state or the URL.
	useEffect(() => {
		const abortControllers = abortControllersRef.current;
		const resumeControllers = resumeControllersRef.current;
		const runs = runsRef.current;
		return () => {
			runs.forEach((run) => {
				run.canceled = true;
			});
			runs.clear();
			Array.from(abortControllers.values())
				.concat(Array.from(resumeControllers.values()))
				.forEach((controller) => {
					controller.abort();
				});
		};
	}, []);

	// Drop a local item once its saved row carries every final result, so the
	// gallery switches to the persisted copy without a flash of pending state.
	useEffect(() => {
		if (!historyData || dbIdByLocalId.size === 0) {
			return;
		}
		const finalRowIds = new Set(
			historyData.items
				.filter((item) => !item.models.some((m) => isPendingVideoModel(m)))
				.map((item) => item.id),
		);
		const doneIds = new Set(
			activeItems
				.filter((item) => {
					const dbId = dbIdByLocalId.get(item.id);
					return (
						dbId !== undefined &&
						finalRowIds.has(dbId) &&
						item.models.every((m) => !m.isLoading)
					);
				})
				.map((item) => item.id),
		);
		if (doneIds.size === 0) {
			return;
		}
		setActiveItems((prev) => prev.filter((item) => !doneIds.has(item.id)));
		setDbIdByLocalId((prev) => {
			const next = new Map(prev);
			doneIds.forEach((id) => next.delete(id));
			return next;
		});
	}, [activeItems, dbIdByLocalId, historyData]);

	// Resume polling for saved rows whose jobs were still running when the page
	// was last left, and record the results the same way a live run does.
	useEffect(() => {
		if (!historyData) {
			return;
		}
		const localRowIds = new Set(dbIdByLocalId.values());
		for (const item of historyData.items) {
			if (localRowIds.has(item.id) || resumedItemIdsRef.current.has(item.id)) {
				continue;
			}
			const pending = item.models.flatMap((m) =>
				m.jobId && isPendingVideoModel(m) ? [{ ...m, jobId: m.jobId }] : [],
			);
			if (pending.length === 0) {
				continue;
			}
			resumedItemIdsRef.current.add(item.id);
			const results = new Map<string, SavedVideoModelResult>(
				item.models.map((m) => [m.modelId, { ...m }]),
			);
			const persist = async () => {
				try {
					await updateVideoHistory({
						params: { path: { id: item.id } },
						body: { models: Array.from(results.values()) },
					});
				} catch {
					toast.error("Couldn't update this video in your history");
				}
			};
			for (const model of pending) {
				const controllerKey = `${item.id}-${model.modelId}`;
				const controller = new AbortController();
				resumeControllersRef.current.set(controllerKey, controller);
				void (async () => {
					try {
						for await (const job of pollVideoJob(
							model.jobId,
							fetchClient,
							controller.signal,
						)) {
							const outcome = savedResultForJob(job);
							if (outcome) {
								results.set(model.modelId, { ...model, ...outcome });
								await persist();
							}
						}
					} catch (error) {
						if (error instanceof DOMException && error.name === "AbortError") {
							return;
						}
						// Only a missing job is final; any other poll failure leaves the
						// row pending so the next page load retries it.
						if (error instanceof VideoPollError && error.status === 404) {
							results.set(model.modelId, {
								...model,
								error: "Video is no longer available",
							});
							await persist();
						}
					} finally {
						resumeControllersRef.current.delete(controllerKey);
					}
				})();
			}
		}
	}, [dbIdByLocalId, fetchClient, historyData, updateVideoHistory]);

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
		} else if (!canUseEndFrameInputs) {
			setFrameInputs((prev) => (prev.end ? { ...prev, end: null } : prev));
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
		canUseEndFrameInputs,
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

	// Changing one picker keeps that choice and moves the other to the nearest
	// value the selection supports alongside it, instead of snapping the
	// user's choice back.
	const handleSizeChange = useCallback(
		(size: VideoSize) => {
			setVideoSize(size);
			const durations = getSupportedVideoDurationsForSelection(
				videoGenModels,
				selectedModels,
				videoInputMode,
				size,
			);
			if (durations.length > 0 && !durations.includes(videoDuration)) {
				setVideoDuration(
					durations.reduce((closest, candidate) =>
						Math.abs(candidate - videoDuration) <
						Math.abs(closest - videoDuration)
							? candidate
							: closest,
					),
				);
			}
		},
		[selectedModels, videoDuration, videoGenModels, videoInputMode],
	);
	const handleDurationChange = useCallback(
		(duration: VideoDuration) => {
			setVideoDuration(duration);
			const sizes = getSupportedVideoSizesForSelection(
				videoGenModels,
				selectedModels,
				videoInputMode,
				duration,
			);
			if (sizes.length > 0 && !sizes.includes(videoSize)) {
				const resolution = getVideoResolution(videoSize);
				const orientation = getVideoOrientation(videoSize);
				setVideoSize(
					findVideoSize(sizes, resolution, orientation) ??
						findVideoSize(
							sizes,
							resolution,
							orientation === "landscape" ? "portrait" : "landscape",
						) ??
						sizes[0],
				);
			}
		},
		[selectedModels, videoGenModels, videoInputMode, videoSize],
	);

	const inputImageCount =
		videoInputMode === "frames"
			? (frameInputs.start ? 1 : 0) + (frameInputs.end ? 1 : 0)
			: videoInputMode === "reference"
				? referenceImages.length
				: 0;
	const estimatedCostUsd = useMemo(
		() =>
			estimateVideoSelectionCostUsd(
				videoGenModels,
				comparisonMode ? selectedModels : selectedModels.slice(0, 1),
				videoInputMode,
				videoSize,
				videoDuration,
				inputImageCount,
			),
		[
			comparisonMode,
			inputImageCount,
			selectedModels,
			videoDuration,
			videoGenModels,
			videoInputMode,
			videoSize,
		],
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
	const isChatPlanContext = Boolean(selectedOrganization?.kind === "chat");
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
			if (frameInputs.end && !frameInputs.start) {
				toast.error("A last frame needs a first frame. Please add one.");
				return;
			}

			const currentPrompt = effectivePrompt.trim();
			const run = { canceled: false };
			runsRef.current.add(run);
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

			const inputFields = {
				...(referenceImages.length === 0 &&
				referenceVideos.length === 0 &&
				referenceAudios.length === 0 &&
				frameInputs.start
					? { image: { image_url: frameInputs.start.dataUrl } }
					: {}),
				...(referenceImages.length === 0 &&
				referenceVideos.length === 0 &&
				referenceAudios.length === 0 &&
				frameInputs.end
					? { last_frame: { image_url: frameInputs.end.dataUrl } }
					: {}),
				...(referenceImages.length > 0
					? {
							reference_images: referenceImages.map((image) => ({
								image_url: image.dataUrl,
							})),
						}
					: {}),
				...(referenceVideos.length > 0
					? { reference_videos: referenceVideos }
					: {}),
				...(referenceAudios.length > 0
					? { reference_audios: referenceAudios }
					: {}),
			};

			const results = new Map<string, SavedVideoModelResult>(
				modelsToGenerate.map((modelId) => [
					modelId,
					{
						modelId,
						modelName: getModelName(modelId),
						jobId: null,
						videoUrl: null,
						expiresAt: null,
					},
				]),
			);
			const setResult = (
				modelId: string,
				patch: Partial<SavedVideoModelResult>,
			) => {
				const current = results.get(modelId);
				if (current) {
					results.set(modelId, { ...current, ...patch });
				}
			};

			// The history row is created by the first accepted job and updated as
			// the others are accepted, finish or fail. Writes are chained so they
			// reach the API in order and each carries the latest snapshot; nothing
			// waits on a sibling submission that may be stalled.
			let savedId: string | null = null;
			let saveFailed = false;
			let historyChain: Promise<void> = Promise.resolve();
			const persist = () => {
				historyChain = historyChain.then(async () => {
					const snapshot = Array.from(results.values());
					if (saveFailed || (!savedId && !snapshot.some((m) => m.jobId))) {
						return;
					}
					try {
						if (savedId) {
							await updateVideoHistory({
								params: { path: { id: savedId } },
								body: { models: snapshot },
							});
							return;
						}
						const saved = await saveVideoHistory({
							body: {
								prompt: currentPrompt,
								organizationId: selectedOrganization?.id,
								frameInputs: placeholderItem.frameInputs,
								referenceImages: placeholderItem.referenceImages,
								models: snapshot,
							},
						});
						savedId = saved.item.id;
						// A run reset by "New chat" keeps its saved row (the jobs exist
						// and the resume effect adopts them) but must not touch the page
						// state that now belongs to the next run.
						if (run.canceled) {
							return;
						}
						setDbIdByLocalId((prev) =>
							new Map(prev).set(itemId, saved.item.id),
						);
						setSelectedItemId(saved.item.id);
						const params = new URLSearchParams(window.location.search);
						params.set("id", saved.item.id);
						router.replace(`${pathname}?${params.toString()}`, {
							scroll: false,
						});
					} catch {
						if (!savedId) {
							saveFailed = true;
						}
						toast.error(
							savedId
								? "Couldn't update this generation in your history"
								: "Couldn't save this generation to your history",
						);
					}
				});
				return historyChain;
			};

			const createJob = async (
				modelId: string,
				signal: AbortSignal,
			): Promise<VideoJob | null> => {
				try {
					const noFallback = shouldDisableFallback(modelId);
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
							...inputFields,
						}),
						signal,
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
								: organizationCreditErrorMessage(
										rawMessage,
										selectedOrganization?.role,
										response.status,
									),
						);
					}

					const job: VideoJob = await response.json();
					updateGalleryModel(itemId, modelId, { job, isLoading: true });
					setResult(modelId, { jobId: job.id });
					void persist();
					return job;
				} catch (error) {
					if (error instanceof DOMException && error.name === "AbortError") {
						setResult(modelId, { error: "Canceled" });
						void persist();
						return null;
					}
					const errorMessage =
						error instanceof Error ? error.message : "Video generation failed";
					toast.error(errorMessage);
					updateGalleryModel(itemId, modelId, {
						isLoading: false,
						error: errorMessage,
					});
					setResult(modelId, { error: errorMessage });
					void persist();
					return null;
				}
			};

			void Promise.all(
				modelsToGenerate.map(async (modelId) => {
					const controller = new AbortController();
					abortControllersRef.current.set(`${itemId}-${modelId}`, controller);
					try {
						const job = await createJob(modelId, controller.signal);
						if (!job) {
							return;
						}
						for await (const updatedJob of pollVideoJob(
							job.id,
							fetchClient,
							controller.signal,
						)) {
							const outcome = savedResultForJob(updatedJob);
							if (updatedJob.status === "completed" && outcome) {
								updateGalleryModel(itemId, modelId, {
									job: updatedJob,
									videoUrl: outcome.videoUrl ?? null,
									expiresAt: outcome.expiresAt ?? null,
									isLoading: false,
								});
								setResult(modelId, outcome);
								await persist();
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
								if (outcome) {
									setResult(modelId, outcome);
									await persist();
								}
							} else {
								updateGalleryModel(itemId, modelId, { job: updatedJob });
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
						// A failed poll says nothing about the job: the saved row stays
						// pending and the next page load resumes it.
						updateGalleryModel(itemId, modelId, {
							isLoading: false,
							error: errorMessage,
						});
					} finally {
						abortControllersRef.current.delete(`${itemId}-${modelId}`);
						// A reset run already released the generating state.
						if (!run.canceled) {
							pendingRef.current--;
							if (pendingRef.current === 0) {
								setIsGenerating(false);
								runsRef.current.delete(run);
							}
						}
					}
				}),
			);
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
			selectedOrganization?.role,
			isChatPlanContext,
			chatPlanSubscribed,
			pathname,
			router,
			saveVideoHistory,
			updateVideoHistory,
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
		runsRef.current.forEach((run) => {
			run.canceled = true;
		});
		runsRef.current.clear();
		Array.from(abortControllersRef.current.values()).forEach((controller) => {
			controller.abort();
		});
		abortControllersRef.current.clear();
		setActiveItems([]);
		// Saved rows of the aborted runs are no longer local, so the resume
		// effect picks their still-running jobs back up.
		setDbIdByLocalId(new Map());
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
					{isLowCredits &&
						!isChatPlanContext &&
						isOrganizationAdmin(selectedOrganization?.role) && (
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
						setVideoSize={handleSizeChange}
						videoDuration={videoDuration}
						setVideoDuration={handleDurationChange}
						audioEnabled={effectiveAudioEnabled}
						setAudioEnabled={setAudioEnabled}
						audioToggleDisabled={isGenerating || audioToggleLocked}
						audioToggleDisabledReason={audioToggleLockedReason}
						canUseFrameInputs={canUseFrameInputs}
						canUseEndFrameInputs={canUseEndFrameInputs}
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
						estimatedCostUsd={estimatedCostUsd}
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
