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
import { useCallback, useRef, useState } from "react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { registry } from "@/lib/canvas/registry";
import { emptySpec, templates } from "@/lib/canvas/templates";

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
}

export default function CanvasPageClient({
	models,
	providers,
	selectedOrganization,
}: CanvasPageClientProps) {
	const [selectedModel, setSelectedModel] = useState<string>(
		"anthropic/claude-sonnet-4-20250514",
	);

	const [spec, setSpec] = useState<Spec>(emptySpec);
	const [editorValue, setEditorValue] = useState(
		JSON.stringify(emptySpec, null, 2),
	);
	const [parseError, setParseError] = useState<string | null>(null);
	const [prompt, setPrompt] = useState("");
	const [selectedTemplateName, setSelectedTemplateName] = useState<string>("");
	const [showResetDialog, setShowResetDialog] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [showEditor, setShowEditor] = useState(true);
	const [previewExpanded, _setPreviewExpanded] = useState(false);
	const [exporting, setExporting] = useState<"pdf" | "image" | null>(null);
	const previewRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const isMobile = useIsMobile();

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

	const handleGenerate = useCallback(async () => {
		if (!prompt.trim() || isGenerating) {
			return;
		}

		setIsGenerating(true);
		abortRef.current = new AbortController();

		try {
			const response = await fetch("/api/canvas/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt,
					model: selectedModel,
				}),
				signal: abortRef.current.signal,
			});

			if (!response.ok) {
				throw new Error(`Generation failed: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response stream");
			}

			const decoder = new TextDecoder();
			let specStreamBuffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				specStreamBuffer += decoder.decode(value, { stream: true });

				if (specStreamBuffer.trim()) {
					try {
						const compiled = compileSpecStream(
							specStreamBuffer,
						) as unknown as Spec;
						if (compiled.root && Object.keys(compiled.elements).length > 0) {
							setSpec(compiled);
							setEditorValue(JSON.stringify(compiled, null, 2));
							setParseError(null);
						}
					} catch {
						// Spec not complete yet, continue
					}
				}
			}

			if (specStreamBuffer.trim()) {
				try {
					const compiled = compileSpecStream(
						specStreamBuffer,
					) as unknown as Spec;
					setSpec(compiled);
					setEditorValue(JSON.stringify(compiled, null, 2));
					setParseError(null);
				} catch {
					try {
						const parsed = JSON.parse(specStreamBuffer) as Spec;
						if (parsed.root && parsed.elements) {
							setSpec(parsed);
							setEditorValue(JSON.stringify(parsed, null, 2));
							setParseError(null);
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
			setIsGenerating(false);
			abortRef.current = null;
		}
	}, [prompt, isGenerating, selectedModel]);

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

	const hasSpec = spec.root !== null && Object.keys(spec.elements).length > 0;
	const isDefaultSpec = JSON.stringify(spec) === JSON.stringify(emptySpec);

	const handleResetCanvas = useCallback(() => {
		setSpec(emptySpec);
		setEditorValue(JSON.stringify(emptySpec, null, 2));
		setParseError(null);
		setSelectedTemplateName("");
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
						selectedOrganization={selectedOrganization}
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
										<textarea
											value={editorValue}
											onChange={handleEditorChange}
											onKeyDown={handleEditorKeyDown}
											spellCheck={false}
											className="flex-1 resize-none bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none"
										/>
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
										<textarea
											value={editorValue}
											onChange={handleEditorChange}
											onKeyDown={handleEditorKeyDown}
											spellCheck={false}
											className="flex-1 resize-none bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none"
										/>
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
									<JSONUIProvider
										key={JSON.stringify(spec.state ?? {})}
										registry={registry}
										initialState={spec.state ?? {}}
									>
										<Renderer spec={spec} registry={registry} />
									</JSONUIProvider>
								</div>

								{/* Prompt input */}
								<div className="px-0 pb-0 sm:px-4">
									<div className="mx-auto w-full max-w-3xl bg-background px-0 pb-0 pt-2 sm:px-4">
										<PromptInput
											onSubmit={() => {
												void handleGenerate();
											}}
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
													<PromptInputButton
														onClick={handleStop}
														variant="ghost"
													>
														<Square className="h-3.5 w-3.5" />
													</PromptInputButton>
												) : (
													<PromptInputSubmit disabled={!prompt.trim()} />
												)}
											</PromptInputToolbar>
										</PromptInput>
									</div>
								</div>
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
		</>
	);
}
