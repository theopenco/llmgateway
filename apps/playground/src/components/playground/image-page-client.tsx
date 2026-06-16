"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ImageControls } from "@/components/playground/image-controls";
import { ImageGallery } from "@/components/playground/image-gallery";
import { ImageHeader } from "@/components/playground/image-header";
import { ImageSidebar } from "@/components/playground/image-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
	useImageHistory,
	useImageHistoryItem,
	useSaveImageHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import { useAppConfig } from "@/lib/config";
import { getModelImageConfig } from "@/lib/image-gen";
import { mapModels } from "@/lib/mapmodels";
import {
	getModelPreferenceCookie,
	IMAGE_MODEL_COOKIE,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { shouldDisableFallback } from "@/lib/no-fallback";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { AspectRatio, GalleryItem } from "@/lib/image-gen";
import type { ComboboxModel, Organization, Project } from "@/lib/types";

interface ImagePageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialModelPreference?: string | null;
}

export default function ImagePageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects: _projects,
	selectedProject,
	initialModelPreference,
}: ImagePageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const posthog = usePostHog();
	const config = useAppConfig();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	// Filter models to image-gen only (includes image-edit models), sorted
	// newest-first by releasedAt with createdAt as fallback. releasedAt comes
	// from the static model definition so the order is stable regardless of
	// when each row was inserted into the gateway DB.
	const imageGenModels = useMemo(
		() =>
			models
				.filter((m) => m.output?.includes("image"))
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
		() => mapModels(imageGenModels, providers),
		[imageGenModels, providers],
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
			getModelPreferenceCookie(IMAGE_MODEL_COOKIE) ?? initialModelPreference;
		if (stored) {
			const models = stored.split(",").filter(Boolean);
			if (models.length > 0) {
				return models;
			}
		}
		const first = imageGenModels[0];
		return first ? [first.id] : [];
	});
	const [comparisonMode, setComparisonMode] = useState(
		() => searchParams.get("compare") === "1",
	);
	const [prompt, setPrompt] = useState("");
	const [activeItems, setActiveItems] = useState<GalleryItem[]>([]);
	const imageIdFromUrl = searchParams.get("id");
	const [selectedItemId, setSelectedItemId] = useState<string | null>(
		imageIdFromUrl,
	);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showTopUp, setShowTopUp] = useState(false);

	// Image config state
	const [imageAspectRatio, setImageAspectRatio] = useState<AspectRatio>("auto");
	const [imageSize, setImageSize] = useState<string>("1K");
	const [alibabaImageSize, setAlibabaImageSize] = useState<string>(() => {
		const primaryModel = selectedModels[0] ?? "";
		const config = getModelImageConfig(primaryModel);
		return config.isGptImage ? config.defaultSize : "1024x1024";
	});
	const [imageQuality, setImageQuality] = useState<string>(() => {
		const primaryModel = selectedModels[0] ?? "";
		const config = getModelImageConfig(primaryModel);
		return config.defaultQuality ?? "auto";
	});
	const [imageCount, setImageCount] = useState<1 | 2 | 3 | 4>(1);

	// Input images for image-edit models
	const [inputImages, setInputImages] = useState<
		{ dataUrl: string; mediaType: string }[]
	>([]);

	// Resolve model definitions for all selected models (handles "providerId/modelId" format)
	const selectedModelDefs = useMemo(() => {
		return selectedModels
			.map((modelId) => {
				const rootId = modelId.includes("/")
					? modelId.split("/").pop()!
					: modelId;
				return imageGenModels.find((m) => m.id === rootId) ?? null;
			})
			.filter((m): m is NonNullable<typeof m> => m !== null);
	}, [selectedModels, imageGenModels]);

	// Detect if all selected models support image input (editing)
	const isEditModel = useMemo(() => {
		return (
			selectedModelDefs.length > 0 &&
			selectedModelDefs.every((m) =>
				m.mappings.some((mapping) => mapping.vision === true),
			)
		);
	}, [selectedModelDefs]);

	// Detect if any selected model requires image input
	const requiresImageInput = useMemo(() => {
		return selectedModelDefs.some((m) => m.imageInputRequired === true);
	}, [selectedModelDefs]);

	// Auth
	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	// DB-persisted history
	const { data: historyData, isLoading: isHistoryLoading } = useImageHistory(
		isAuthenticated,
		selectedOrganization?.id,
	);
	const { mutate: saveImageHistory } = useSaveImageHistory();
	const savedItemIdsRef = useRef<Set<string>>(new Set());
	const pendingSaveRef = useRef<{ localId: string; dbId: string } | null>(null);

	// The history list is metadata-only (no base64). Image data is fetched per
	// item below when one is selected.
	const galleryItems = useMemo<GalleryItem[]>(() => {
		const historical: GalleryItem[] = (historyData?.items ?? []).map(
			(item) => ({
				id: item.id,
				prompt: item.prompt,
				timestamp: new Date(item.createdAt).getTime(),
				thumbnailUrl: item.models.some((m) => m.imageCount > 0)
					? `${config.apiUrl}/playground/image-history/${item.id}/thumbnail`
					: null,
				models: item.models.map((m) => ({
					modelId: m.modelId,
					modelName: m.modelName,
					images: [],
					imageCount: m.imageCount,
					error: m.error,
					isLoading: false,
				})),
			}),
		);
		return [...activeItems, ...historical];
	}, [activeItems, historyData, config.apiUrl]);

	const { data: selectedItemDetail } = useImageHistoryItem(
		activeItems.length === 0 ? selectedItemId : null,
	);

	const displayItems = useMemo<GalleryItem[]>(() => {
		if (activeItems.length > 0) {
			return activeItems;
		}
		if (!selectedItemId) {
			return [];
		}
		const detail = selectedItemDetail?.item;
		if (detail && detail.id === selectedItemId) {
			return [
				{
					id: detail.id,
					prompt: detail.prompt,
					timestamp: new Date(detail.createdAt).getTime(),
					inputImages: detail.inputImages ?? undefined,
					models: detail.models.map((m) => ({ ...m, isLoading: false })),
				},
			];
		}
		// Detail still loading: render the metadata item with per-model
		// skeletons so the gallery shows progress instead of a blank page.
		const light = galleryItems.find((i) => i.id === selectedItemId);
		if (light) {
			return [
				{
					...light,
					models: light.models.map((m) => ({ ...m, isLoading: !m.error })),
				},
			];
		}
		return [];
	}, [activeItems, selectedItemId, selectedItemDetail, galleryItems]);

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
			if (item.models.some((m) => m.images.length > 0)) {
				saveImageHistory(
					{
						body: {
							prompt: item.prompt,
							organizationId: item.organizationId,
							inputImages: item.inputImages,
							models: item.models.map((m) => ({
								modelId: m.modelId,
								modelName: m.modelName,
								images: m.images,
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
	}, [activeItems, saveImageHistory, router, pathname]);

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
			setModelPreferenceCookie(IMAGE_MODEL_COOKIE, selectedModels.join(","));
		}
	}, [selectedModels]);

	// Sync URL → state for back/forward navigation
	useEffect(() => {
		if (imageIdFromUrl !== selectedItemId) {
			setSelectedItemId(imageIdFromUrl);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [imageIdFromUrl]);

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
	}, [selectedItemId, galleryItems, activeItems.length]);

	// Reset image size/quality when the selected model changes and the current
	// value isn't valid for the new model. Including the value itself in deps
	// would clobber the user's explicit selection on every re-render.
	useEffect(() => {
		const primaryModel = selectedModels[0] ?? "";
		const config = getModelImageConfig(primaryModel);
		if (config.usesPixelDimensions) {
			if (
				!(config.availableSizes as readonly string[]).includes(alibabaImageSize)
			) {
				setAlibabaImageSize(config.defaultSize);
			}
		} else if (
			!(config.availableSizes as readonly string[]).includes(imageSize)
		) {
			setImageSize(config.defaultSize);
		}
		if (
			config.supportsQuality &&
			!(config.availableQualities as readonly string[]).includes(imageQuality)
		) {
			setImageQuality(config.defaultQuality ?? "auto");
		}
		if (!isEditModel) {
			setInputImages([]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally exclude size/quality values to avoid clobbering the user's explicit selection
	}, [selectedModels, isEditModel]);

	const getModelName = useCallback(
		(modelId: string) => {
			const model = availableModels.find((m) => m.id === modelId);
			return model?.name ?? modelId;
		},
		[availableModels],
	);

	const generateImages = useCallback(
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

			if (requiresImageInput && inputImages.length === 0) {
				toast.error(
					"This model requires an image input. Please add an image before generating.",
				);
				return;
			}

			const currentPrompt = effectivePrompt.trim();
			setIsGenerating(true);
			posthog.capture("playground_image_generated", {
				models: selectedModels,
				model_count: selectedModels.length,
				comparison_mode: comparisonMode,
				aspect_ratio: imageAspectRatio,
				image_count: imageCount,
				has_input_images: inputImages.length > 0,
			});

			const itemId = crypto.randomUUID();
			const modelsToGenerate = comparisonMode
				? selectedModels
				: selectedModels.slice(0, 1);

			// Create placeholder gallery item
			const placeholderItem: GalleryItem = {
				id: itemId,
				prompt: currentPrompt,
				timestamp: Date.now(),
				organizationId: selectedOrganization?.id,
				inputImages:
					inputImages.length > 0
						? inputImages.map((img) => ({
								dataUrl: img.dataUrl,
								mediaType: img.mediaType,
							}))
						: undefined,
				models: modelsToGenerate.map((modelId) => ({
					modelId,
					modelName: getModelName(modelId),
					images: [],
					isLoading: true,
				})),
			};

			setActiveItems((prev) => [placeholderItem, ...prev]);
			setSelectedItemId(null);
			setPrompt("");
			setInputImages([]);

			// Build image config
			const primaryModel = selectedModels[0] ?? "";
			const config = getModelImageConfig(primaryModel);
			// Always forward the user's quality choice (including "auto") so it
			// shows up in the activity log; the gateway / model treat "auto" the
			// same as omitting the field upstream.
			const includeQuality = config.supportsQuality && !!imageQuality;
			const imageConfigBody = config.usesPixelDimensions
				? {
						...(config.isGptImage
							? alibabaImageSize !== "auto" && {
									image_size: alibabaImageSize,
								}
							: alibabaImageSize !== "1024x1024" && {
									image_size: alibabaImageSize,
								}),
						...(includeQuality && { image_quality: imageQuality }),
						n: imageCount,
					}
				: {
						...(imageAspectRatio !== "auto" && {
							aspect_ratio: imageAspectRatio,
						}),
						...(imageSize !== "1K" && { image_size: imageSize }),
						n: imageCount,
					};

			// Fire requests independently — each updates gallery as images stream in
			pendingRef.current = modelsToGenerate.length;

			for (const modelId of modelsToGenerate) {
				const noFallback = shouldDisableFallback(modelId);
				void (async () => {
					try {
						const response = await fetch("/api/image", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								...(noFallback ? { "x-no-fallback": "true" } : {}),
							},
							body: JSON.stringify({
								prompt: currentPrompt,
								model: modelId,
								image_config: imageConfigBody,
								...(inputImages.length > 0
									? {
											input_images: inputImages.map((img) => ({
												url: img.dataUrl,
												mediaType: img.mediaType,
											})),
										}
									: {}),
							}),
						});

						if (!response.ok) {
							const errorData = await response.json().catch(() => null);
							throw new Error(
								errorData?.error ??
									`HTTP ${response.status}: ${response.statusText}`,
							);
						}

						const data = await response.json();
						const generatedImages = data.images as
							| { base64: string; mediaType: string }[]
							| undefined;

						if (!generatedImages || generatedImages.length === 0) {
							throw new Error(
								"The model did not generate any images. Try a different model.",
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
											images: generatedImages,
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
								: "Image generation failed";
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
			alibabaImageSize,
			imageAspectRatio,
			imageSize,
			imageQuality,
			imageCount,
			inputImages,
			posthog,
			requiresImageInput,
			selectedOrganization?.id,
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
		const first = imageGenModels[0];
		setSelectedModels((prev) => [...prev, first?.id ?? ""]);
	}, [selectedModels.length, imageGenModels]);

	const handleRemoveModel = useCallback((index: number) => {
		setSelectedModels((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleComparisonModeChange = useCallback(
		(enabled: boolean) => {
			setComparisonMode(enabled);
			if (enabled && selectedModels.length < 2) {
				const second = imageGenModels[1] ?? imageGenModels[0];
				if (second) {
					setSelectedModels((prev) => [...prev, second.id]);
				}
			} else if (!enabled) {
				setSelectedModels((prev) => prev.slice(0, 1));
			}
		},
		[selectedModels.length, imageGenModels],
	);

	const handleSuggestionClick = useCallback(
		(suggestion: string) => {
			setPrompt(suggestion);
			void generateImages(suggestion);
		},
		[generateImages],
	);

	const handleNewChat = useCallback(() => {
		setActiveItems([]);
		setSelectedItemId(null);
		setPrompt("");
		setInputImages([]);
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

	const handleUseAsReference = useCallback(
		(image: { base64: string; mediaType: string }) => {
			handleNewChat();
			setInputImages([
				{
					dataUrl: `data:${image.mediaType};base64,${image.base64}`,
					mediaType: image.mediaType,
				},
			]);
		},
		[handleNewChat],
	);

	const handleInsertPrompt = useCallback(
		(prompt: string) => {
			handleNewChat();
			setPrompt(prompt);
		},
		[handleNewChat],
	);

	// Low credits check
	const chatPlanCreditsRemaining =
		selectedOrganization?.chatPlan && selectedOrganization.chatPlan !== "none"
			? Number(selectedOrganization.chatPlanCreditsLimit ?? "0") -
				Number(selectedOrganization.chatPlanCreditsUsed ?? "0")
			: 0;
	const isLowCredits = selectedOrganization
		? Number(selectedOrganization.credits) < 1 && chatPlanCreditsRemaining <= 0
		: false;

	const handleSelectOrganization = useCallback(
		(org: Organization | null) => {
			const params = new URLSearchParams(Array.from(searchParams.entries()));
			if (org?.id) {
				params.set("orgId", org.id);
			} else {
				params.delete("orgId");
			}
			params.delete("projectId");
			router.push(params.toString() ? `/image?${params.toString()}` : "/image");
		},
		[router, searchParams],
	);

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<ImageSidebar
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
					<ImageHeader
						models={imageGenModels}
						providers={providers}
						selectedModels={selectedModels}
						onModelChange={handleModelChange}
						onAddModel={handleAddModel}
						onRemoveModel={handleRemoveModel}
						comparisonMode={comparisonMode}
						onComparisonModeChange={handleComparisonModeChange}
						hideCompare={displayItems.length > 0}
					/>
					{isLowCredits && (
						<div className="bg-yellow-50 dark:bg-yellow-900/20 border-b px-4 py-2 flex items-center justify-between">
							<p className="text-sm text-yellow-800 dark:text-yellow-200">
								Low credits remaining. Top up to continue generating images.
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
					<ImageControls
						prompt={prompt}
						setPrompt={setPrompt}
						selectedModels={selectedModels}
						imageAspectRatio={imageAspectRatio}
						setImageAspectRatio={setImageAspectRatio}
						imageSize={imageSize}
						setImageSize={setImageSize}
						alibabaImageSize={alibabaImageSize}
						setAlibabaImageSize={setAlibabaImageSize}
						imageQuality={imageQuality}
						setImageQuality={setImageQuality}
						imageCount={imageCount}
						setImageCount={setImageCount}
						isGenerating={isGenerating}
						onGenerate={generateImages}
						isEditModel={isEditModel}
						requiresImageInput={requiresImageInput}
						inputImages={inputImages}
						setInputImages={setInputImages}
					/>
					<div className="flex-1 overflow-y-auto p-4">
						<div className="max-w-6xl mx-auto">
							<ImageGallery
								items={displayItems}
								comparisonMode={comparisonMode}
								onSuggestionClick={handleSuggestionClick}
								onUseAsReference={
									isEditModel ? handleUseAsReference : undefined
								}
								onInsertPrompt={handleInsertPrompt}
							/>
						</div>
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
