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
	Maximize2,
	Minimize2,
	Play,
	Send,
	Square,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { CanvasSidebar } from "@/components/playground/canvas-sidebar";
import { Button } from "@/components/ui/button";
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
	SelectValue,
} from "@/components/ui/select";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { catalog } from "@/lib/canvas/catalog";
import { registry } from "@/lib/canvas/registry";
import { emptySpec, templates } from "@/lib/canvas/templates";

import type { Spec } from "@json-render/core";
import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { Organization, Project } from "@/lib/types";

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
	const [isGenerating, setIsGenerating] = useState(false);
	const [showEditor, setShowEditor] = useState(false);
	const [previewExpanded, setPreviewExpanded] = useState(false);
	const [exporting, setExporting] = useState<"pdf" | "image" | null>(null);
	const previewRef = useRef<HTMLDivElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const systemPrompt = useMemo(() => catalog.prompt(), []);

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
		if (!prompt.trim() || isGenerating) return;

		setIsGenerating(true);
		abortRef.current = new AbortController();

		try {
			const response = await fetch("/api/canvas/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt,
					model: selectedModel,
					systemPrompt,
				}),
				signal: abortRef.current.signal,
			});

			if (!response.ok) {
				throw new Error(`Generation failed: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response stream");

			const decoder = new TextDecoder();
			let specStreamBuffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				specStreamBuffer += decoder.decode(value, { stream: true });

				if (specStreamBuffer.trim()) {
					try {
						const compiled = compileSpecStream(
							specStreamBuffer,
						) as unknown as Spec;
						if (
							compiled.root &&
							Object.keys(compiled.elements).length > 0
						) {
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
						setParseError(
							"Failed to parse AI response as a valid spec",
						);
					}
				}
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			toast.error(err instanceof Error ? err.message : "Generation failed");
		} finally {
			setIsGenerating(false);
			abortRef.current = null;
		}
	}, [prompt, isGenerating, selectedModel, systemPrompt]);

	const handlePromptKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleGenerate();
			}
		},
		[handleGenerate],
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
		}
	}, []);

	const handleExport = useCallback(
		async (format: "pdf" | "png") => {
			setExporting(format === "png" ? "image" : "pdf");
			try {
				const response = await fetch("/api/canvas/export", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ spec, format }),
				});
				if (!response.ok) throw new Error("Export failed");
				const blob = await response.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `canvas-export.${format}`;
				a.click();
				URL.revokeObjectURL(url);
				toast.success(`${format.toUpperCase()} exported`);
			} catch {
				toast.error(`Failed to export ${format.toUpperCase()}`);
			} finally {
				setExporting(null);
			}
		},
		[spec],
	);

	const hasSpec = spec.root !== null && Object.keys(spec.elements).length > 0;

	return (
		<SidebarProvider>
			<div className="flex h-dvh w-full">
				<CanvasSidebar selectedOrganization={selectedOrganization} />
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
							<Select onValueChange={handleTemplateSelect}>
								<SelectTrigger className="w-[140px]">
									<LayoutTemplate className="mr-2 h-4 w-4" />
									<SelectValue placeholder="Templates" />
								</SelectTrigger>
								<SelectContent>
									{templates.map((t) => (
										<SelectItem key={t.name} value={t.name}>
											<div>
												<div className="font-medium">
													{t.name}
												</div>
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
										size="sm"
										disabled={exporting !== null || !hasSpec}
									>
										<Download className="mr-2 h-4 w-4" />
										Export
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem
										onClick={() => handleExport("pdf")}
									>
										<FileText className="mr-2 h-4 w-4" />
										Export as PDF
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => handleExport("png")}
									>
										<FileImage className="mr-2 h-4 w-4" />
										Export as PNG
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
							<ThemeToggle />
							<a
								href={
									process.env.NODE_ENV === "development"
										? "http://localhost:3002/dashboard"
										: "https://llmgateway.io/dashboard"
								}
								target="_blank"
								rel="noopener noreferrer"
								className="hidden sm:inline"
							>
								<span className="text-nowrap">Dashboard</span>
							</a>
						</div>
					</header>

					{/* Main content */}
					<div className="flex flex-1 overflow-hidden">
						{/* Editor Panel */}
						{showEditor && !previewExpanded && (
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
										variant={
											showEditor ? "secondary" : "ghost"
										}
										size="sm"
										onClick={() =>
											setShowEditor(!showEditor)
										}
									>
										{showEditor ? (
											<Eye className="mr-1.5 h-3.5 w-3.5" />
										) : (
											<Code className="mr-1.5 h-3.5 w-3.5" />
										)}
										{showEditor ? "Preview" : "Editor"}
									</Button>
									<Button
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
									</Button>
								</div>
							</div>

							{/* Rendered preview */}
							<div
								ref={previewRef}
								className="flex-1 overflow-auto p-6"
							>
								<JSONUIProvider
									key={JSON.stringify(spec.state ?? {})}
									registry={registry}
									initialState={spec.state ?? {}}
								>
									<Renderer
										spec={spec}
										registry={registry}
									/>
								</JSONUIProvider>
							</div>

							{/* Prompt input */}
							<div className="border-t bg-background p-4">
								<div className="mx-auto flex max-w-3xl items-end gap-2">
									<textarea
										value={prompt}
										onChange={(e) =>
											setPrompt(e.target.value)
										}
										onKeyDown={handlePromptKeyDown}
										placeholder="Describe the UI you want to build..."
										rows={1}
										className="flex-1 resize-none rounded-lg border bg-muted/30 px-4 py-3 text-sm outline-none transition-colors focus:bg-background focus:ring-2 focus:ring-ring"
										disabled={isGenerating}
										style={{
											minHeight: "44px",
											maxHeight: "120px",
											height: "auto",
										}}
										onInput={(e) => {
											const target =
												e.target as HTMLTextAreaElement;
											target.style.height = "auto";
											target.style.height =
												Math.min(
													target.scrollHeight,
													120,
												) + "px";
										}}
									/>
									{isGenerating ? (
										<Button
											size="icon"
											variant="destructive"
											onClick={handleStop}
											className="shrink-0"
										>
											<Square className="h-3.5 w-3.5" />
										</Button>
									) : (
										<Button
											size="icon"
											onClick={handleGenerate}
											disabled={!prompt.trim()}
											className="shrink-0"
										>
											<Send className="h-4 w-4" />
										</Button>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</SidebarProvider>
	);
}
