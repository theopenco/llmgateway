"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { useUser } from "@/hooks/useUser";
import { getModelImageConfig, streamImageParts } from "@/lib/image-gen";
import { mapModels } from "@/lib/mapmodels";

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
}

export default function ImagePageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects,
	selectedProject,
}: ImagePageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	// Filter models to image-gen only (includes image-edit models)
	const imageGenModels = useMemo(
		() => models.filter((m) => m.output?.includes("image")),
		[models],
	);

	const mapped = useMemo(
		() => mapModels(imageGenModels, providers),
		[imageGenModels, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	// State — initialize from URL params
	const [selectedModels, setSelectedModels] = useState<string[]>(() => {
		const modelParam = searchParams.get("model");
		if (modelParam) {
			const models = modelParam.split(",").filter(Boolean);
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
	const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showTopUp, setShowTopUp] = useState(false);
	const [recentPrompts, setRecentPrompts] = useState<string[]>([]);

	// Image config state
	const [imageAspectRatio, setImageAspectRatio] = useState<AspectRatio>("auto");
	const [imageSize, setImageSize] = useState<string>("1K");
	const [alibabaImageSize, setAlibabaImageSize] = useState<string>("1024x1024");
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

	// Detect if any selected model supports image input (editing)
	const isEditModel = useMemo(() => {
		return selectedModelDefs.some((m) =>
			m.mappings.some((mapping) => mapping.vision === true),
		);
	}, [selectedModelDefs]);

	// Detect if any selected model requires image input
	const requiresImageInput = useMemo(() => {
		return selectedModelDefs.some((m) => m.imageInputRequired === true);
	}, [selectedModelDefs]);

	// Auth
	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

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

	// Reset imageSize when model changes, clear input images when switching away from edit model
	useEffect(() => {
		const primaryModel = selectedModels[0] ?? "";
		const config = getModelImageConfig(primaryModel);
		if (!config.availableSizes.includes(imageSize as never)) {
			setImageSize(config.defaultSize);
		}
		if (!isEditModel) {
			setInputImages([]);
		}
	}, [selectedModels, imageSize, imageGenModels, isEditModel]);

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

			// Add to recent prompts
			setRecentPrompts((prev) => {
				const updated = [
					currentPrompt,
					...prev.filter((p) => p !== currentPrompt),
				];
				return updated.slice(0, 20);
			});

			const itemId = crypto.randomUUID();

			// Create placeholder gallery item
			const placeholderItem: GalleryItem = {
				id: itemId,
				prompt: currentPrompt,
				timestamp: Date.now(),
				models: selectedModels.map((modelId) => ({
					modelId,
					modelName: getModelName(modelId),
					images: [],
					isLoading: true,
				})),
			};

			setGalleryItems((prev) => [placeholderItem, ...prev]);
			setPrompt("");
			setInputImages([]);

			// Build image config
			const primaryModel = selectedModels[0] ?? "";
			const config = getModelImageConfig(primaryModel);
			const imageConfigBody = config.usesPixelDimensions
				? {
						...(alibabaImageSize !== "1024x1024" && {
							image_size: alibabaImageSize,
						}),
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
			pendingRef.current = selectedModels.length;

			for (const modelId of selectedModels) {
				const isProviderSpecific = modelId.includes("/");
				void (async () => {
					try {
						const response = await fetch("/api/chat", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								...(isProviderSpecific ? { "x-no-fallback": "true" } : {}),
							},
							body: JSON.stringify({
								messages: [
									{
										role: "user",
										parts: [
											...inputImages.map((img) => ({
												type: "file" as const,
												url: img.dataUrl,
												mediaType: img.mediaType,
											})),
											{ type: "text", text: currentPrompt },
										],
									},
								],
								model: modelId,
								is_image_gen: true,
								image_config: imageConfigBody,
							}),
						});

						if (!response.ok) {
							const errorData = await response.json().catch(() => null);
							throw new Error(
								errorData?.error ??
									`HTTP ${response.status}: ${response.statusText}`,
							);
						}

						await streamImageParts(response, (image) => {
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
											return {
												...m,
												images: [...m.images, image],
											};
										}),
									};
								}),
							);
						});

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
										return { ...m, isLoading: false };
									}),
								};
							}),
						);
					} catch (error) {
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
										return {
											...m,
											isLoading: false,
											error:
												error instanceof Error
													? error.message
													: "Image generation failed",
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
			prompt,
			selectedModels,
			isGenerating,
			getModelName,
			alibabaImageSize,
			imageAspectRatio,
			imageSize,
			imageCount,
			inputImages,
			requiresImageInput,
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

	// Low credits check
	const isLowCredits = selectedOrganization
		? Number(selectedOrganization.credits) < 1
		: false;

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<ImageSidebar
					recentPrompts={recentPrompts}
					onPromptClick={handleSuggestionClick}
					selectedOrganization={selectedOrganization}
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
