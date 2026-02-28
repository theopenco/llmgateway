"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ImageControls } from "@/components/playground/image-controls";
import { ImageGallery } from "@/components/playground/image-gallery";
import { ImageHeader } from "@/components/playground/image-header";
import { ImageSidebar } from "@/components/playground/image-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { getModelImageConfig, parseImageStream } from "@/lib/image-gen";
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
	const searchParams = useSearchParams();

	// Filter models to image-gen only
	const imageGenModels = useMemo(
		() => models.filter((m) => m.output?.includes("image")),
		[models],
	);

	const mapped = useMemo(
		() => mapModels(imageGenModels, providers),
		[imageGenModels, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	// State
	const [selectedModels, setSelectedModels] = useState<string[]>(() => {
		const first = imageGenModels[0];
		return first ? [first.id] : [];
	});
	const [comparisonMode, setComparisonMode] = useState(false);
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

	// Auth
	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	// Ensure playground key
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

	// Reset imageSize when model changes
	useEffect(() => {
		const primaryModel = selectedModels[0] ?? "";
		const config = getModelImageConfig(primaryModel);
		if (!config.availableSizes.includes(imageSize as never)) {
			setImageSize(config.defaultSize);
		}
	}, [selectedModels, imageSize]);

	const getModelName = useCallback(
		(modelId: string) => {
			const model = availableModels.find((m) => m.id === modelId);
			return model?.name ?? modelId;
		},
		[availableModels],
	);

	const generateImages = useCallback(
		async (overridePrompt?: string) => {
			const effectivePrompt = overridePrompt ?? prompt;
			if (
				!effectivePrompt.trim() ||
				selectedModels.length === 0 ||
				isGenerating
			) {
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

			// Fire parallel requests
			const results = await Promise.allSettled(
				selectedModels.map(async (modelId) => {
					const isProviderSpecific = modelId.includes("/");
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
										parts: [{ type: "text", text: currentPrompt }],
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

						const images = await parseImageStream(response);
						if (images.length === 0) {
							throw new Error("No images returned");
						}
						return { modelId, images };
					} catch (error) {
						return {
							modelId,
							images: [],
							error:
								error instanceof Error
									? error.message
									: "Image generation failed",
						};
					}
				}),
			);

			// Update gallery item with results
			setGalleryItems((prev) =>
				prev.map((item) => {
					if (item.id !== itemId) {
						return item;
					}
					return {
						...item,
						models: item.models.map((model) => {
							const result = results.find((r) => {
								if (r.status === "fulfilled") {
									return r.value.modelId === model.modelId;
								}
								return false;
							});
							if (result?.status === "fulfilled") {
								return {
									...model,
									images: result.value.images,
									error: result.value.error,
									isLoading: false,
								};
							}
							// Rejected promise
							const rejected = results.find((r) => r.status === "rejected");
							return {
								...model,
								isLoading: false,
								error:
									rejected?.status === "rejected"
										? String(rejected.reason)
										: "Generation failed",
							};
						}),
					};
				}),
			);

			setIsGenerating(false);
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
