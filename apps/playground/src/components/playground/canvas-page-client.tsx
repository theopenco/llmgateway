"use client";

import { compileSpecStream } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import {
	Code,
	Download,
	Eye,
	FileImage,
	FileText,
	LayoutTemplate,
	Loader2,
	Play,
	Square,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	memo,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";

import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { CanvasSidebar } from "@/components/playground/canvas-sidebar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUser } from "@/hooks/useUser";
import { registry } from "@/lib/canvas/registry";
import { emptySpec, templates } from "@/lib/canvas/templates";
import {
	CANVAS_MODEL_COOKIE,
	getModelPreferenceCookie,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { getErrorMessage } from "@/lib/utils";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { Organization, Project } from "@/lib/types";
import type { Spec } from "@json-render/core";

interface CanvasPageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialModelPreference?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isRenderableSpec(value: unknown): value is Spec {
	if (!isRecord(value)) {
		return false;
	}

	const elements = value.elements;

	return (
		Boolean(value.root) &&
		isRecord(elements) &&
		Object.keys(elements).length > 0
	);
}

const DEFAULT_CANVAS_MODEL = "anthropic/claude-sonnet-4-20250514";

function CanvasSpecSkeleton() {
	return (
		<div className="flex h-full min-h-[280px] flex-col gap-3 p-4">
			<Skeleton className="h-3 w-20 rounded-sm" />
			<div className="space-y-2 pl-4">
				<Skeleton className="h-3 w-32 rounded-sm" />
				<Skeleton className="h-3 w-48 rounded-sm" />
				<Skeleton className="h-3 w-28 rounded-sm" />
			</div>
			<Skeleton className="h-3 w-24 rounded-sm" />
			<div className="space-y-2 pl-4">
				<Skeleton className="h-3 w-56 rounded-sm" />
				<Skeleton className="h-3 w-44 rounded-sm" />
				<Skeleton className="h-3 w-64 rounded-sm" />
				<Skeleton className="h-3 w-36 rounded-sm" />
			</div>
			<Skeleton className="h-3 w-28 rounded-sm" />
			<div className="space-y-2 pl-4">
				<Skeleton className="h-3 w-48 rounded-sm" />
				<Skeleton className="h-3 w-72 rounded-sm" />
				<Skeleton className="h-3 w-52 rounded-sm" />
				<Skeleton className="h-3 w-60 rounded-sm" />
			</div>
			<Skeleton className="h-3 w-24 rounded-sm" />
			<div className="space-y-2 pl-8">
				<Skeleton className="h-3 w-44 rounded-sm" />
				<Skeleton className="h-3 w-56 rounded-sm" />
				<Skeleton className="h-3 w-36 rounded-sm" />
			</div>
			<Skeleton className="h-3 w-16 rounded-sm" />
			<div className="space-y-2 pl-4">
				<Skeleton className="h-3 w-64 rounded-sm" />
				<Skeleton className="h-3 w-40 rounded-sm" />
				<Skeleton className="h-3 w-72 rounded-sm" />
			</div>
			<Skeleton className="h-3 w-12 rounded-sm" />
		</div>
	);
}

function CanvasPreviewSkeleton() {
	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
			<Skeleton className="h-10 w-2/5" />
			<Skeleton className="h-4 w-3/5" />
			<div className="grid gap-4 sm:grid-cols-3">
				<Skeleton className="h-28" />
				<Skeleton className="h-28" />
				<Skeleton className="h-28" />
			</div>
			<Skeleton className="h-52 w-full" />
			<div className="grid gap-4 sm:grid-cols-2">
				<Skeleton className="h-32" />
				<Skeleton className="h-32" />
			</div>
		</div>
	);
}

async function getResponseErrorMessage(response: Response): Promise<string> {
	const fallback = `HTTP ${response.status}: ${response.statusText}`;
	const text = await response.text().catch(() => "");

	if (!text.trim()) {
		return fallback;
	}

	try {
		const payload: unknown = JSON.parse(text);
		const message = getErrorMessage(payload);

		return message === "An unknown error occurred" ? fallback : message;
	} catch {
		const message = getErrorMessage(text);

		return message === "An unknown error occurred" ? fallback : message;
	}
}

interface CanvasPromptInputProps {
	isGenerating: boolean;
	onGenerate: (prompt: string) => void;
	onStop: () => void;
	promptRef: RefObject<HTMLTextAreaElement | null>;
}

const CanvasPromptInput = memo(function CanvasPromptInput({
	isGenerating,
	onGenerate,
	onStop,
	promptRef,
}: CanvasPromptInputProps) {
	const [prompt, setPrompt] = useState("");

	const handleSubmit = useCallback(() => {
		onGenerate(prompt);
	}, [onGenerate, prompt]);

	return (
		<div className="px-0 pb-0 sm:px-4">
			<div className="mx-auto w-full max-w-3xl bg-background px-0 pb-0 pt-2 sm:px-4">
				<PromptInput
					onSubmit={handleSubmit}
					aria-disabled={isGenerating}
					className="[&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-x-0 [&_[data-slot=input-group]]:border-b-0 sm:[&_[data-slot=input-group]]:rounded-md sm:[&_[data-slot=input-group]]:border"
				>
					<PromptInputBody>
						<PromptInputTextarea
							ref={promptRef}
							value={prompt}
							onChange={(e) => setPrompt(e.currentTarget.value)}
							placeholder="Describe the UI you want to build..."
							disabled={isGenerating}
						/>
					</PromptInputBody>
					<PromptInputToolbar>
						<PromptInputTools />
						{isGenerating ? (
							<PromptInputButton onClick={onStop} variant="ghost">
								<Square className="h-3.5 w-3.5" />
							</PromptInputButton>
						) : (
							<PromptInputSubmit disabled={!prompt.trim()} />
						)}
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
});

export default function CanvasPageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	selectedProject,
	initialModelPreference,
}: CanvasPageClientProps) {
	const [selectedModel, setSelectedModel] = useState<string>(() => {
		const stored =
			getModelPreferenceCookie(CANVAS_MODEL_COOKIE) ?? initialModelPreference;
		if (stored) {
			return stored;
		}
		return DEFAULT_CANVAS_MODEL;
	});

	const [spec, setSpec] = useState<Spec>(emptySpec);
	const [editorValue, setEditorValue] = useState(
		JSON.stringify(emptySpec, null, 2),
	);
	const [parseError, setParseError] = useState<string | null>(null);
	const [selectedTemplateName, setSelectedTemplateName] = useState<string>("");
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [promptResetKey, setPromptResetKey] = useState(0);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [hasStreamingSpec, setHasStreamingSpec] = useState(false);
	const [showEditor, setShowEditor] = useState(true);
	const [previewExpanded, _setPreviewExpanded] = useState(false);
	const [exporting, setExporting] = useState<"pdf" | "image" | null>(null);
	const previewRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const isMobile = useIsMobile();

	const { user, isLoading: isUserLoading } = useUser();
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
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
				params.toString() ? `/canvas?${params.toString()}` : "/canvas",
			);
		},
		[router, searchParams],
	);
	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;
	const ensuredProjectRef = useRef<string | null>(null);

	useEffect(() => {
		if (selectedModel) {
			setModelPreferenceCookie(CANVAS_MODEL_COOKIE, selectedModel);
		}
	}, [selectedModel]);

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
				// ignore for now
			}
		};
		void ensureKey();
	}, [isAuthenticated, selectedOrganization, selectedProject]);

	const handleEditorChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setEditorValue(e.target.value);
		},
		[],
	);

	const handleApply = useCallback(() => {
		try {
			const parsed = JSON.parse(editorValue) as Spec;
			if (!parsed.root || !parsed.elements) {
				setParseError("Spec must have 'root' and 'elements' fields");
				return;
			}
			setSpec(parsed);
			setParseError(null);
		} catch (err) {
			setParseError(err instanceof Error ? err.message : "Invalid JSON");
		}
	}, [editorValue]);

	const handleEditorKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				handleApply();
			}
			if (e.key === "Tab") {
				e.preventDefault();
				const target = e.currentTarget;
				const start = target.selectionStart;
				const end = target.selectionEnd;
				const value = target.value;
				const newValue =
					value.substring(0, start) + "\t" + value.substring(end);
				setEditorValue(newValue);
				requestAnimationFrame(() => {
					target.selectionStart = target.selectionEnd = start + 1;
				});
			}
		},
		[handleApply],
	);

	const applySpec = useCallback((nextSpec: Spec) => {
		setSpec(nextSpec);
		setEditorValue(JSON.stringify(nextSpec, null, 2));
		setParseError(null);
	}, []);

	const handleGenerate = useCallback(
		async (prompt: string) => {
			if (!prompt.trim() || isGenerating) {
				return;
			}

			const controller = new AbortController();
			setIsGenerating(true);
			setParseError(null);
			setSelectedTemplateName("");
			setHasStreamingSpec(false);
			abortRef.current = controller;

			try {
				const response = await fetch("/api/canvas/generate", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						prompt,
						model: selectedModel,
					}),
					signal: controller.signal,
				});

				if (!response.ok) {
					throw new Error(await getResponseErrorMessage(response));
				}

				const reader = response.body?.getReader();
				if (!reader) {
					throw new Error("No response stream");
				}

				const decoder = new TextDecoder();
				let specStreamBuffer = "";
				let didResetForStream = false;

				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					specStreamBuffer += decoder.decode(value, { stream: true });

					if (specStreamBuffer.trim()) {
						if (!didResetForStream) {
							setSpec(emptySpec);
							didResetForStream = true;
						}
						setHasStreamingSpec(true);
						setEditorValue(specStreamBuffer);

						try {
							const compiled = compileSpecStream(specStreamBuffer) as unknown;
							if (isRenderableSpec(compiled)) {
								applySpec(compiled);
							}
						} catch {
							// Spec not complete yet, continue
						}
					}
				}

				if (specStreamBuffer.trim()) {
					let appliedFinalSpec = false;
					try {
						const compiled = compileSpecStream(specStreamBuffer) as unknown;
						if (isRenderableSpec(compiled)) {
							applySpec(compiled);
							setHasStreamingSpec(true);
							appliedFinalSpec = true;
						}
					} catch {
						// Fall back to JSON.parse below.
					}

					if (!appliedFinalSpec) {
						try {
							const parsed = JSON.parse(specStreamBuffer) as unknown;
							if (isRenderableSpec(parsed)) {
								applySpec(parsed);
								setHasStreamingSpec(true);
							} else {
								setParseError("Failed to parse AI response as a valid spec");
							}
						} catch {
							setParseError("Failed to parse AI response as a valid spec");
						}
					}
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") {
					return;
				}
				toast.error(err instanceof Error ? err.message : "Generation failed");
			} finally {
				if (abortRef.current === controller) {
					setIsGenerating(false);
					abortRef.current = null;
				}
			}
		},
		[applySpec, isGenerating, selectedModel],
	);

	const handleStop = useCallback(() => {
		abortRef.current?.abort();
		setIsGenerating(false);
	}, []);

	const handleTemplateSelect = useCallback((templateName: string) => {
		const template = templates.find((t) => t.name === templateName);
		if (template) {
			const json = JSON.stringify(template.spec, null, 2);
			setEditorValue(json);
			setSpec(template.spec);
			setParseError(null);
			setSelectedTemplateName(templateName);
		}
	}, []);

	const handleExport = useCallback(async (format: "pdf" | "png") => {
		const node = previewRef.current;
		if (!node) {
			toast.error("Preview not available");
			return;
		}
		setExporting(format === "png" ? "image" : "pdf");
		try {
			const { toPng } = await import("html-to-image");
			const backgroundColor = window.getComputedStyle(
				document.body,
			).backgroundColor;
			const dataUrl = await toPng(node, {
				cacheBust: true,
				pixelRatio: 2,
				backgroundColor,
				width: node.scrollWidth,
				height: node.scrollHeight,
				style: {
					overflow: "visible",
					maxHeight: "none",
				},
			});

			if (format === "png") {
				const a = document.createElement("a");
				a.href = dataUrl;
				a.download = "canvas-export.png";
				a.click();
				toast.success("PNG exported");
				return;
			}

			const { jsPDF } = await import("jspdf");
			const pxW = node.scrollWidth * 2;
			const pxH = node.scrollHeight * 2;
			const ptW = pxW * (72 / 96);
			const ptH = pxH * (72 / 96);
			// eslint-disable-next-line new-cap
			const pdf = new jsPDF({
				orientation: ptW > ptH ? "landscape" : "portrait",
				unit: "pt",
				format: [ptW, ptH],
			});
			const rgb = backgroundColor.match(/\d+/g);
			if (rgb && rgb.length >= 3) {
				pdf.setFillColor(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]));
				pdf.rect(0, 0, ptW, ptH, "F");
			}
			pdf.addImage(dataUrl, "PNG", 0, 0, ptW, ptH);
			pdf.save("canvas-export.pdf");
			toast.success("PDF exported");
		} catch {
			toast.error(`Failed to export ${format.toUpperCase()}`);
		} finally {
			setExporting(null);
		}
	}, []);

	const hasSpec = useMemo(
		() => spec.root !== null && Object.keys(spec.elements).length > 0,
		[spec],
	);
	const isDefaultSpec = useMemo(
		() => JSON.stringify(spec) === JSON.stringify(emptySpec),
		[spec],
	);
	const specStateKey = useMemo(
		() => JSON.stringify(spec.state ?? {}),
		[spec.state],
	);
	const showGenerationLoading = isGenerating && !hasStreamingSpec;

	const handleResetCanvas = useCallback(() => {
		setSpec(emptySpec);
		setEditorValue(JSON.stringify(emptySpec, null, 2));
		setParseError(null);
		setHasStreamingSpec(false);
		setSelectedTemplateName("");
		setPromptResetKey((key) => key + 1);
		setShowResetDialog(false);
		setTimeout(() => promptRef.current?.focus(), 50);
	}, []);

	const handleNewCanvas = useCallback(() => {
		if (hasSpec && !isDefaultSpec) {
			setShowResetDialog(true);
		} else {
			promptRef.current?.focus();
		}
	}, [hasSpec, isDefaultSpec]);

	return (
		<>
			<SidebarProvider>
				<div className="flex h-dvh w-full">
					<CanvasSidebar
						organizations={organizations}
						selectedOrganization={selectedOrganization}
						onSelectOrganization={handleSelectOrganization}
						onNewCanvas={handleNewCanvas}
					/>
					<div className="flex min-w-0 flex-1 flex-col">
						{/* Header */}
						<header className="bg-background flex items-center border-b p-4">
							<div className="flex min-w-0 flex-1 items-center gap-3">
								<SidebarTrigger />
								<div className="flex w-full min-w-0 max-w-[360px] items-center gap-2 sm:max-w-[420px]">
									<ModelSelector
										models={models}
										providers={providers}
										value={selectedModel}
										onValueChange={setSelectedModel}
										placeholder="Search and select a model..."
									/>
								</div>
							</div>
							<div className="ml-3 flex items-center gap-2">
								<Select
									value={selectedTemplateName}
									onValueChange={handleTemplateSelect}
								>
									<SelectTrigger className="h-9 w-auto min-w-[120px] max-w-[220px]">
										<div className="flex min-w-0 items-center gap-2 overflow-hidden">
											<LayoutTemplate className="h-4 w-4 shrink-0" />
											<span className="truncate text-sm">
												{selectedTemplateName || "Templates"}
											</span>
										</div>
									</SelectTrigger>
									<SelectContent>
										{templates.map((t) => (
											<SelectItem key={t.name} value={t.name}>
												<div>
													<div className="font-medium">{t.name}</div>
													<div className="text-xs text-muted-foreground">
														{t.description}
													</div>
												</div>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											disabled={exporting !== null || !hasSpec}
										>
											<Download className="h-4 w-4 sm:mr-2" />
											<span className="hidden sm:inline">Export</span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => handleExport("pdf")}>
											<FileText className="mr-2 h-4 w-4" />
											Export as PDF
										</DropdownMenuItem>
										<DropdownMenuItem onClick={() => handleExport("png")}>
											<FileImage className="mr-2 h-4 w-4" />
											Export as PNG
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</header>

						{/* Main content */}
						<div className="flex flex-1 overflow-hidden">
							{/* Editor Panel - Sheet on mobile, side column on desktop */}
							{isMobile ? (
								<Sheet open={showEditor} onOpenChange={setShowEditor}>
									<SheetContent
										side="left"
										className="flex flex-col gap-0 p-0"
										aria-describedby={undefined}
									>
										<div className="flex items-center justify-between border-b px-4 py-2 pr-12">
											<SheetTitle className="text-sm font-medium text-muted-foreground">
												JSON Spec
											</SheetTitle>
											<div className="flex items-center gap-2">
												{parseError && (
													<span className="max-w-[180px] truncate text-xs text-destructive">
														{parseError}
													</span>
												)}
												<Button
													size="sm"
													variant="secondary"
													onClick={handleApply}
												>
													<Play className="mr-1.5 h-3 w-3" />
													Apply
												</Button>
											</div>
										</div>
										{showGenerationLoading ? (
											<CanvasSpecSkeleton />
										) : (
											<textarea
												value={editorValue}
												onChange={handleEditorChange}
												onKeyDown={handleEditorKeyDown}
												readOnly={isGenerating}
												spellCheck={false}
												className={`flex-1 resize-none bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none ${
													isGenerating ? "cursor-wait select-none" : ""
												}`}
											/>
										)}
									</SheetContent>
								</Sheet>
							) : (
								showEditor &&
								!previewExpanded && (
									<div className="flex w-[400px] flex-col border-r">
										<div className="flex items-center justify-between border-b px-4 py-2">
											<span className="text-sm font-medium text-muted-foreground">
												JSON Spec
											</span>
											<div className="flex items-center gap-2">
												{parseError && (
													<span className="max-w-[180px] truncate text-xs text-destructive">
														{parseError}
													</span>
												)}
												<Button
													size="sm"
													variant="secondary"
													onClick={handleApply}
												>
													<Play className="mr-1.5 h-3 w-3" />
													Apply
												</Button>
											</div>
										</div>
										{showGenerationLoading ? (
											<CanvasSpecSkeleton />
										) : (
											<textarea
												value={editorValue}
												onChange={handleEditorChange}
												onKeyDown={handleEditorKeyDown}
												readOnly={isGenerating}
												spellCheck={false}
												className={`flex-1 resize-none bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none ${
													isGenerating ? "cursor-wait select-none" : ""
												}`}
											/>
										)}
									</div>
								)
							)}

							{/* Preview Panel */}
							<div className="flex flex-1 flex-col">
								<div className="flex items-center justify-between border-b px-4 py-2">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-muted-foreground">
											Preview
										</span>
										{isGenerating && (
											<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
												<Loader2 className="h-3 w-3 animate-spin" />
												Generating...
											</div>
										)}
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant={showEditor ? "secondary" : "ghost"}
											size="sm"
											onClick={() => setShowEditor(!showEditor)}
										>
											{showEditor ? (
												<Eye className="h-3.5 w-3.5 sm:mr-1.5" />
											) : (
												<Code className="h-3.5 w-3.5 sm:mr-1.5" />
											)}
											<span className="hidden sm:inline">
												{showEditor ? "Preview" : "Editor"}
											</span>
										</Button>
										{/* Hidden: expand/collapse button is redundant for now */}
										{/* <Button
										variant="ghost"
										size="icon"
										className="h-8 w-8"
										onClick={() =>
											setPreviewExpanded(
												!previewExpanded,
											)
										}
									>
										{previewExpanded ? (
											<Minimize2 className="h-3.5 w-3.5" />
										) : (
											<Maximize2 className="h-3.5 w-3.5" />
										)}
									</Button> */}
									</div>
								</div>

								{/* Rendered preview */}
								<div ref={previewRef} className="flex-1 overflow-auto p-6">
									{showGenerationLoading ? (
										<CanvasPreviewSkeleton />
									) : (
										<JSONUIProvider
											key={specStateKey}
											registry={registry}
											initialState={spec.state ?? {}}
										>
											<Renderer spec={spec} registry={registry} />
										</JSONUIProvider>
									)}
								</div>

								{/* Prompt input */}
								<CanvasPromptInput
									key={promptResetKey}
									isGenerating={isGenerating}
									onGenerate={(prompt) => {
										void handleGenerate(prompt);
									}}
									onStop={handleStop}
									promptRef={promptRef}
								/>
							</div>
						</div>
					</div>
				</div>
			</SidebarProvider>
			<Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reset canvas?</DialogTitle>
						<DialogDescription>
							Your current canvas has content. Starting a new canvas will clear
							everything. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowResetDialog(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleResetCanvas}>
							Reset canvas
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AuthDialog open={showAuthDialog} returnUrl={pathname} />
		</>
	);
}
