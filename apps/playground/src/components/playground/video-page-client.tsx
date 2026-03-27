"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { VideoControls } from "@/components/playground/video-controls";
import { VideoGallery } from "@/components/playground/video-gallery";
import { VideoHeader } from "@/components/playground/video-header";
import { VideoSidebar } from "@/components/playground/video-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { mapModels } from "@/lib/mapmodels";
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
}

export default function VideoPageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects,
	selectedProject,
}: VideoPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	const videoGenModels = useMemo(
		() => models.filter((m) => m.output?.includes("video")),
		[models],
	);

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
		const first = videoGenModels[0];
		return first ? [first.id] : [];
	});
	const [comparisonMode, setComparisonMode] = useState(
		() => searchParams.get("compare") === "1",
	);
	const [prompt, setPrompt] = useState("");
	const [galleryItems, setGalleryItems] = useState<VideoGalleryItem[]>([]);
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
			if (ensuredProjectRef.current === selectedProject.id) {
				return;
			}
			try {
				await fetch("/api/ensure-playground-key", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId: selectedProject.id }),
				});
				ensuredProjectRef.current = selectedProject.id;
			} catch {
				// ignore
			}
		};
		void ensureKey();
	}, [isAuthenticated, selectedOrganization, selectedProject]);

	// Cleanup abort controllers on unmount
	useEffect(() => {
		return () => {
			Array.from(abortControllersRef.current.values()).forEach((controller) => {
				controller.abort();
			});
		};
	}, []);

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
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		if (comparisonMode) {
			params.set("model", selectedModels.join(","));
			params.set("compare", "1");
		} else {
			const primary = selectedModels[0];
			if (primary) {
				params.set("model", primary);
			} else {
				params.delete("model");
			}
			params.delete("compare");
		}
		const qs = params.toString();
		router.replace(qs ? `?${qs}` : "");
	}, [selectedModels, comparisonMode]);

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
			setGalleryItems((prev) =>
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
					isLoading: true,
				})),
			};

			setGalleryItems((prev) => [placeholderItem, ...prev]);
			setPrompt("");
			setFrameInputs({
				start: null,
				end: null,
			});
			setReferenceImages([]);

			pendingRef.current = selectedModels.length;

			for (const modelId of selectedModels) {
				const isProviderSpecific = modelId.includes("/");
				const controllerKey = `${itemId}-${modelId}`;
				const controller = new AbortController();
				abortControllersRef.current.set(controllerKey, controller);

				void (async () => {
					try {
						const response = await fetch("/api/video", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								...(isProviderSpecific ? { "x-no-fallback": "true" } : {}),
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
							controller.signal,
						)) {
							if (updatedJob.status === "completed") {
								const videoUrl =
									updatedJob.content?.[0]?.url ??
									`/api/video/${updatedJob.id}/content`;
								updateGalleryModel(itemId, modelId, {
									job: updatedJob,
									videoUrl,
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
						updateGalleryModel(itemId, modelId, {
							isLoading: false,
							error:
								error instanceof Error
									? error.message
									: "Video generation failed",
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
			prompt,
			selectedModels,
			isGenerating,
			getModelName,
			videoSize,
			videoDuration,
			effectiveAudioEnabled,
			frameInputs,
			referenceImages,
			updateGalleryModel,
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
		setGalleryItems([]);
		setPrompt("");
		setFrameInputs({ start: null, end: null });
		setReferenceImages([]);
		setIsGenerating(false);
		pendingRef.current = 0;
	}, []);

	const handleItemClick = useCallback((itemId: string) => {
		const element = document.getElementById(`gallery-${itemId}`);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, []);

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
								items={galleryItems}
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
