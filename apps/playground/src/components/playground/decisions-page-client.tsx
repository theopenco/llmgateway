"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AuthDialog } from "@/components/playground/auth-dialog";
import { DecisionsControls } from "@/components/playground/decisions-controls";
import { DecisionsGallery } from "@/components/playground/decisions-gallery";
import { DecisionsHeader } from "@/components/playground/decisions-header";
import { DecisionsSidebar } from "@/components/playground/decisions-sidebar";
import { ChatPlanUpsell } from "@/components/pricing/chat-plan-upsell";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
	useDecisionHistory,
	useDecisionHistoryItem,
	useSaveDecisionHistory,
} from "@/hooks/usePlaygroundHistory";
import { useUser } from "@/hooks/useUser";
import {
	chatPlanCreditErrorMessage,
	isInsufficientCreditsError,
	organizationCreditErrorMessage,
} from "@/lib/credit-error";
import {
	decisionModelAcceptsImages,
	initialDecisionModels,
} from "@/lib/decision-models";
import {
	buildDecisionInput,
	fromQuestionDrafts,
	normalizeDecisionQuestions,
	toQuestionDrafts,
} from "@/lib/decisions";
import { useApi } from "@/lib/fetch-client";
import { mapModels } from "@/lib/mapmodels";
import {
	DECISIONS_MODEL_COOKIE,
	getModelPreferenceCookie,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { shouldDisableFallback } from "@/lib/no-fallback";

import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import type {
	DecisionAnswer,
	DecisionGalleryItem,
	DecisionInputImage,
	DecisionQuestionDraft,
	DecisionScenario,
	DecisionUsage,
} from "@/lib/decisions";
import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { ComboboxModel, Organization, Project } from "@/lib/types";

// Opened on demand only; lazy loading keeps the Stripe top-up dialog and
// @stripe/react-stripe-js out of the page's initial bundle. It renders
// nothing until opened, so there is no SSR output to lose.
const TopUpCreditsDialog = dynamic(
	() =>
		import("@/components/credits/top-up-credits-dialog").then(
			(m) => m.TopUpCreditsDialog,
		),
	{ ssr: false },
);

// id/model/compare are view state, written through the History API so a
// write never cancels a router navigation that is still committing and
// `window.location` is current for the next effect. Next keeps
// useSearchParams in sync with native pushState/replaceState.
function writeSearchParams(
	params: URLSearchParams,
	mode: "push" | "replace" = "replace",
) {
	const qs = params.toString();
	const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
	if (url === `${window.location.pathname}${window.location.search}`) {
		return;
	}
	if (mode === "push") {
		window.history.pushState(window.history.state, "", url);
	} else {
		window.history.replaceState(window.history.state, "", url);
	}
}

interface DecisionsPageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	selectedProject: Project | null;
	initialModelPreference?: string | null;
}

export default function DecisionsPageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	selectedProject,
	initialModelPreference,
}: DecisionsPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const api = useApi();
	const posthog = usePostHog();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();

	const decisionModels = useMemo(
		() =>
			models.slice().sort((a, b) => {
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
		() => mapModels(decisionModels, providers),
		[decisionModels, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	const [selectedModels, setSelectedModels] = useState<string[]>(() =>
		initialDecisionModels(
			[
				searchParams.get("model"),
				getModelPreferenceCookie(DECISIONS_MODEL_COOKIE) ??
					initialModelPreference,
			],
			availableModels,
		),
	);
	const [comparisonMode, setComparisonMode] = useState(
		() => searchParams.get("compare") === "1",
	);
	const [input, setInput] = useState("");
	const [inputImages, setInputImages] = useState<DecisionInputImage[]>([]);
	const [questions, setQuestions] = useState<DecisionQuestionDraft[]>([]);
	const [activeItems, setActiveItems] = useState<DecisionGalleryItem[]>([]);
	const runIdFromUrl = searchParams.get("id");
	const [selectedItemId, setSelectedItemId] = useState<string | null>(
		runIdFromUrl,
	);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showTopUp, setShowTopUp] = useState(false);
	// Bumped whenever the editor is filled from outside (a preset, a history
	// item) so the question panel unfolds to show what was loaded.
	const [editorRevision, setEditorRevision] = useState(0);

	// Auth
	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	// DB-persisted history
	const { data: historyData, isLoading: isHistoryLoading } = useDecisionHistory(
		isAuthenticated,
		selectedOrganization?.id,
	);
	const { mutateAsync: saveDecisionHistory } = useSaveDecisionHistory();
	// Runs whose save was attempted; a failed save is not retried on its own.
	const savedItemIdsRef = useRef<Set<string>>(new Set());
	// The run currently loaded into the editor. Restoring happens whenever
	// the selection moves to a different run, and only then, so history
	// refetches never clobber edits made while viewing a run.
	const [restoredItemId, setRestoredItemId] = useState<string | null>(null);
	// Mirrors for callbacks that resolve after the user may have moved on.
	const selectedItemIdRef = useRef<string | null>(selectedItemId);
	selectedItemIdRef.current = selectedItemId;
	const activeItemsRef = useRef<DecisionGalleryItem[]>(activeItems);
	activeItemsRef.current = activeItems;
	// Saves whose row has not shown up in the history list yet: local
	// placeholder id → database id. State rather than a ref so the hand-over
	// effect re-runs when a save lands after the refetch already resolved.
	const [pendingSaves, setPendingSaves] = useState<Map<string, string>>(
		() => new Map(),
	);

	// The list leaves image payloads out; fetch them for the opened run only.
	const selectedListItem = useMemo(
		() => historyData?.items.find((item) => item.id === selectedItemId),
		[historyData, selectedItemId],
	);
	const { data: selectedDetail, isError: isSelectedDetailError } =
		useDecisionHistoryItem(
			selectedListItem?.inputImageCount ? selectedListItem.id : null,
		);

	const galleryItems = useMemo<DecisionGalleryItem[]>(() => {
		const historical: DecisionGalleryItem[] = (historyData?.items ?? []).map(
			(item) => ({
				id: item.id,
				prompt: item.prompt,
				title: item.title,
				timestamp: new Date(item.createdAt).getTime(),
				inputImages:
					selectedDetail?.item.id === item.id
						? (selectedDetail.item.inputImages ?? undefined)
						: undefined,
				inputImageCount: item.inputImageCount,
				persisted: true,
				questions: item.questions,
				models: item.models.map((m) => ({ ...m, isLoading: false })),
			}),
		);
		return [...activeItems, ...historical];
	}, [activeItems, historyData, selectedDetail]);

	const displayItems = useMemo<DecisionGalleryItem[]>(() => {
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
			// A run where every model failed stays on screen with its errors but
			// is not worth a history row.
			if (!item.models.some((m) => m.answers !== null)) {
				continue;
			}
			// mutateAsync rather than mutate: per-call callbacks of a shared
			// mutation only fire for its latest call, and two runs can finish
			// close together.
			void saveDecisionHistory({
				body: {
					prompt: item.prompt,
					organizationId: item.organizationId,
					inputImages: item.inputImages,
					questions: item.questions,
					models: item.models.map((m) => ({
						modelId: m.modelId,
						modelName: m.modelName,
						answers: m.answers,
						usage: m.usage ?? null,
						error: m.error,
					})),
				},
			})
				.then((data) => {
					const newId = data.item.id;
					setPendingSaves((prev) => new Map(prev).set(item.id, newId));
					// Only follow the saved run if the user is still looking at it
					// and has not started a newer run since.
					const stillOnScreen =
						selectedItemIdRef.current === null &&
						activeItemsRef.current[0]?.id === item.id;
					if (!stillOnScreen) {
						return;
					}
					// The editor already holds this run; restoring it again would
					// undo edits made after the run.
					setRestoredItemId(newId);
					setSelectedItemId(newId);
					const params = new URLSearchParams(window.location.search);
					params.set("id", newId);
					writeSearchParams(params);
				})
				.catch(() => {
					toast.error(
						"The run finished but could not be saved to your history.",
					);
				});
		}
	}, [activeItems, saveDecisionHistory]);

	useEffect(() => {
		if (pendingSaves.size === 0 || !historyData) {
			return;
		}
		const localIds = new Set<string>();
		pendingSaves.forEach((dbId, localId) => {
			if (historyData.items.some((i) => i.id === dbId)) {
				localIds.add(localId);
			}
		});
		if (localIds.size === 0) {
			return;
		}
		setActiveItems((prev) => prev.filter((i) => !localIds.has(i.id)));
		setPendingSaves((prev) => {
			const next = new Map(prev);
			localIds.forEach((localId) => next.delete(localId));
			return next;
		});
	}, [historyData, pendingSaves]);

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	// Ensure playground key
	const pendingRef = useRef(0);
	// Incremented for every run (and on reset) so finally blocks from requests
	// of an abandoned run can't decrement the counter of the one currently
	// running.
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
		// searchParams reference that re-triggers this effect.
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
		writeSearchParams(currentParams);
	}, [comparisonMode, selectedModels]);

	useEffect(() => {
		if (selectedModels.length > 0) {
			setModelPreferenceCookie(
				DECISIONS_MODEL_COOKIE,
				selectedModels.join(","),
			);
		}
	}, [selectedModels]);

	// Sync URL → state for back/forward navigation
	useEffect(() => {
		if (runIdFromUrl !== selectedItemId) {
			setSelectedItemId(runIdFromUrl);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runIdFromUrl]);

	// Load a history item into the editor so it can be re-run or tweaked.
	const restoreItem = useCallback(
		(item: DecisionGalleryItem) => {
			setRestoredItemId(item.id);
			// Models can leave the catalogue; fall back to what is still offered.
			const wanted = item.models.map((m) => m.modelId);
			const modelIds = initialDecisionModels(
				[wanted.join(",")],
				availableModels,
			);
			if (modelIds.length < wanted.length) {
				toast.info(
					"Some models from this run are no longer available and were replaced.",
				);
			}
			setComparisonMode(modelIds.length > 1);
			setSelectedModels(modelIds);
			setInput(item.prompt);
			setInputImages(item.inputImages ?? []);
			setQuestions(toQuestionDrafts(item.questions));
			setEditorRevision((revision) => revision + 1);
		},
		[availableModels],
	);

	// Whether the opened run is still waiting for its image payloads.
	const isRestoring = Boolean(
		selectedItemId &&
		selectedItemId !== restoredItemId &&
		selectedListItem?.inputImageCount &&
		!selectedDetail &&
		!isSelectedDetailError,
	);

	// Restore whenever the selection moves to a run that is not in the editor
	// yet: sidebar clicks, the URL on load, and back/forward navigation.
	useEffect(() => {
		if (!selectedItemId || isGenerating || selectedItemId === restoredItemId) {
			return;
		}
		const item = galleryItems.find((i) => i.id === selectedItemId);
		if (!item?.persisted) {
			return;
		}
		// Wait for the image payloads of an image run so the editor gets them;
		// if they cannot be loaded, restore the text and questions anyway.
		if (item.inputImageCount && !item.inputImages) {
			if (!isSelectedDetailError) {
				return;
			}
			toast.error("The images of this run could not be loaded.");
		}
		// Opening a run replaces whatever unsaved results were on screen.
		setActiveItems([]);
		restoreItem(item);
	}, [
		selectedItemId,
		restoredItemId,
		isGenerating,
		galleryItems,
		restoreItem,
		isSelectedDetailError,
	]);

	// Images only make sense when every selected model can read them; drop
	// them when the selection changes to a text-only model.
	const acceptsImages = useMemo(
		() =>
			selectedModels.length > 0 &&
			selectedModels.every((modelId) =>
				decisionModelAcceptsImages(modelId, decisionModels),
			),
		[selectedModels, decisionModels],
	);
	useEffect(() => {
		if (!acceptsImages) {
			setInputImages([]);
		}
	}, [acceptsImages]);

	const getModelName = useCallback(
		(modelId: string) => {
			const model = availableModels.find((m) => m.id === modelId);
			return model?.name ?? modelId;
		},
		[availableModels],
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

	const runDecision = useCallback(() => {
		const text = input.trim();
		const normalizedQuestions = normalizeDecisionQuestions(
			fromQuestionDrafts(questions),
		);
		if (
			(!text && inputImages.length === 0) ||
			normalizedQuestions.length === 0 ||
			selectedModels.length === 0 ||
			isGenerating
		) {
			return;
		}

		setIsGenerating(true);
		posthog.capture("playground_decision_run", {
			models: selectedModels,
			model_count: selectedModels.length,
			comparison_mode: comparisonMode,
			question_count: normalizedQuestions.length,
			question_types: normalizedQuestions.map((q) => q.type),
			image_count: inputImages.length,
		});

		const itemId = crypto.randomUUID();
		const modelsToRun = comparisonMode
			? selectedModels
			: selectedModels.slice(0, 1);
		const images = [...inputImages];

		const placeholderItem: DecisionGalleryItem = {
			id: itemId,
			prompt: text,
			timestamp: Date.now(),
			organizationId: selectedOrganization?.id,
			inputImages: images.length > 0 ? images : undefined,
			questions: normalizedQuestions,
			models: modelsToRun.map((modelId) => ({
				modelId,
				modelName: getModelName(modelId),
				answers: null,
				isLoading: true,
			})),
		};

		setActiveItems((prev) => [placeholderItem, ...prev]);
		setSelectedItemId(null);
		// The editor now holds this run, not the one it was loaded from.
		setRestoredItemId(null);
		const params = new URLSearchParams(window.location.search);
		params.delete("id");
		writeSearchParams(params);
		requestAnimationFrame(() => {
			document
				.getElementById(`gallery-${itemId}`)
				?.scrollIntoView({ block: "start", behavior: "smooth" });
		});

		// Fire requests independently; each updates the gallery as it lands.
		const generationId = ++generationIdRef.current;
		pendingRef.current = modelsToRun.length;

		modelsToRun.forEach((modelId, modelIndex) => {
			const noFallback = shouldDisableFallback(modelId);
			void (async () => {
				try {
					const response = await fetch("/api/decisions", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(noFallback ? { "x-no-fallback": "true" } : {}),
						},
						body: JSON.stringify({
							model: modelId,
							input: buildDecisionInput(text, images),
							questions: normalizedQuestions,
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
								? chatPlanCreditErrorMessage(chatPlanSubscribed, "decisions")
								: organizationCreditErrorMessage(
										rawMessage,
										selectedOrganization?.role,
										response.status,
									),
						);
					}

					const data = (await response.json()) as {
						answers?: DecisionAnswer[];
						usage?: DecisionUsage;
					};
					if (!Array.isArray(data.answers)) {
						throw new Error(
							"The model returned no answers. Try a different model.",
						);
					}

					setActiveItems((prev) =>
						prev.map((item) => {
							if (item.id !== itemId) {
								return item;
							}
							return {
								...item,
								models: item.models.map((m, index) =>
									index !== modelIndex
										? m
										: {
												...m,
												answers: data.answers ?? null,
												usage: data.usage ?? null,
												isLoading: false,
											},
								),
							};
						}),
					);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : "The decision failed";
					setActiveItems((prev) =>
						prev.map((item) => {
							if (item.id !== itemId) {
								return item;
							}
							return {
								...item,
								models: item.models.map((m, index) =>
									index !== modelIndex
										? m
										: { ...m, isLoading: false, error: errorMessage },
								),
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
		});
	}, [
		input,
		inputImages,
		questions,
		selectedModels,
		isGenerating,
		comparisonMode,
		posthog,
		selectedOrganization,
		getModelName,
		isChatPlanContext,
		chatPlanSubscribed,
	]);

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
		const next =
			decisionModels.find((m) => !selectedModels.includes(m.id)) ??
			decisionModels[0];
		setSelectedModels((prev) => [...prev, next?.id ?? ""]);
	}, [selectedModels, decisionModels]);

	const handleRemoveModel = useCallback((index: number) => {
		setSelectedModels((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleComparisonModeChange = useCallback(
		(enabled: boolean) => {
			setComparisonMode(enabled);
			if (enabled && selectedModels.length < 2) {
				const second =
					decisionModels.find((m) => !selectedModels.includes(m.id)) ??
					decisionModels[0];
				if (second) {
					setSelectedModels((prev) => [...prev, second.id]);
				}
			} else if (!enabled) {
				setSelectedModels((prev) => prev.slice(0, 1));
			}
		},
		[selectedModels, decisionModels],
	);

	const handleLoadScenario = useCallback((scenario: DecisionScenario) => {
		setInput(scenario.input);
		setInputImages([]);
		setQuestions(toQuestionDrafts(scenario.questions));
		setEditorRevision((revision) => revision + 1);
	}, []);

	const handleNewRun = useCallback(() => {
		setActiveItems([]);
		setSelectedItemId(null);
		setRestoredItemId(null);
		setInput("");
		setInputImages([]);
		setQuestions([]);
		// Drops image decodes still in flight for the cleared editor.
		setEditorRevision((revision) => revision + 1);
		setIsGenerating(false);
		setComparisonMode(false);
		generationIdRef.current++;
		pendingRef.current = 0;
		const params = new URLSearchParams(window.location.search);
		params.delete("id");
		writeSearchParams(params);
	}, []);

	const handleItemClick = useCallback(
		(itemId: string) => {
			if (isGenerating) {
				return;
			}
			// A run that is still on screen (saving, or failed and never saved)
			// has nothing to restore; just bring it into view.
			if (activeItems.some((i) => i.id === itemId)) {
				document
					.getElementById(`gallery-${itemId}`)
					?.scrollIntoView({ block: "start", behavior: "smooth" });
				return;
			}
			const item = galleryItems.find((i) => i.id === itemId);
			if (!item) {
				return;
			}
			// Opening a run replaces whatever unsaved results were on screen;
			// the restore effect fills the editor once any images have loaded.
			setActiveItems([]);
			setSelectedItemId(itemId);
			const params = new URLSearchParams(window.location.search);
			params.set("id", itemId);
			if (item.models.length > 1) {
				params.set("compare", "1");
			} else {
				params.delete("compare");
			}
			writeSearchParams(params, "push");
		},
		[isGenerating, activeItems, galleryItems],
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
			router.push(
				params.toString() ? `/decisions?${params.toString()}` : "/decisions",
			);
		},
		[router, searchParams],
	);

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<DecisionsSidebar
					galleryItems={galleryItems}
					isHistoryLoading={isHistoryLoading}
					onNewChat={handleNewRun}
					onItemClick={handleItemClick}
					organizations={organizations}
					selectedOrganization={selectedOrganization}
					onSelectOrganization={handleSelectOrganization}
					currentItemId={selectedItemId}
				/>
				<div className="flex flex-1 flex-col min-w-0">
					<DecisionsHeader
						models={decisionModels}
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
									Low credits remaining. Top up to keep running decisions.
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
					<div className="flex-1 overflow-y-auto">
						<DecisionsControls
							input={input}
							setInput={setInput}
							inputImages={inputImages}
							setInputImages={setInputImages}
							acceptsImages={acceptsImages}
							questions={questions}
							setQuestions={setQuestions}
							editorRevision={editorRevision}
							selectedModels={selectedModels}
							isGenerating={isGenerating}
							isRestoring={isRestoring}
							onGenerate={runDecision}
							onLoadScenario={handleLoadScenario}
						/>
						<div className="p-4">
							{showPlanUpsell ? (
								<ChatPlanUpsell
									noun="decisions"
									isAuthenticated={!!user}
									subscribed={chatPlanSubscribed}
								/>
							) : (
								<div className="max-w-6xl mx-auto">
									<DecisionsGallery
										items={displayItems}
										comparisonMode={comparisonMode}
										onScenarioClick={handleLoadScenario}
									/>
								</div>
							)}
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
