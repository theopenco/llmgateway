"use client";

import { Check, Copy, Eye, ImageIcon, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

/**
 * Model data structure from list-models tool
 */
interface ModelData {
	id: string;
	name: string;
	family?: string;
	providers: string[];
	capabilities: {
		vision: boolean;
		tools: boolean;
		reasoning: boolean;
		streaming: boolean;
		imageGeneration: boolean;
	};
	pricing: {
		input: string;
		output: string;
	};
	context_length?: number;
	free: boolean;
}

/**
 * Image model data structure from list-image-models tool
 */
interface ImageModelData {
	id: string;
	name: string;
	description?: string;
	family?: string;
	requestPrice?: number;
	providers: string[];
}

/**
 * Type guard to check if output contains models list
 */
export function hasModelsOutput(output: unknown): output is {
	text: string;
	models: ModelData[];
} {
	if (typeof output !== "object" || output === null) {
		return false;
	}
	if (!("models" in output) || !Array.isArray((output as any).models)) {
		return false;
	}
	const models = (output as any).models;
	if (models.length === 0) {
		return false;
	}
	const first = models[0];
	return (
		typeof first === "object" &&
		first !== null &&
		"id" in first &&
		"capabilities" in first
	);
}

/**
 * Type guard to check if output contains image models list
 */
export function hasImageModelsOutput(output: unknown): output is {
	text: string;
	imageModels: ImageModelData[];
} {
	if (typeof output !== "object" || output === null) {
		return false;
	}
	if (
		!("imageModels" in output) ||
		!Array.isArray((output as any).imageModels)
	) {
		return false;
	}
	const models = (output as any).imageModels;
	if (models.length === 0) {
		return false;
	}
	const first = models[0];
	return typeof first === "object" && first !== null && "id" in first;
}

/**
 * Model card component for displaying LLM models
 */
function ModelCard({ model }: { model: ModelData }) {
	const [copied, setCopied] = useState(false);

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(model.id);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Ignore errors
		}
	};

	const capabilities = [];
	if (model.capabilities.vision) {
		capabilities.push("Vision");
	}
	if (model.capabilities.tools) {
		capabilities.push("Tools");
	}
	if (model.capabilities.reasoning) {
		capabilities.push("Reasoning");
	}
	if (model.capabilities.imageGeneration) {
		capabilities.push("Image Gen");
	}

	const formatContextSize = (size?: number) => {
		if (!size) {
			return null;
		}
		if (size >= 1000000) {
			return `${(size / 1000000).toFixed(1)}M`;
		}
		if (size >= 1000) {
			return `${(size / 1000).toFixed(0)}K`;
		}
		return size.toString();
	};

	return (
		<div className="flex-shrink-0 w-[280px] rounded-lg border bg-card p-4 space-y-3">
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<h4 className="font-semibold text-sm truncate">{model.name}</h4>
					{model.family && (
						<Badge variant="secondary" className="mt-1 text-[10px]">
							{model.family}
						</Badge>
					)}
				</div>
				{model.free && (
					<Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
						FREE
					</Badge>
				)}
			</div>

			<div className="flex items-center gap-2">
				<code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono truncate">
					{model.id}
				</code>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 w-6 p-0 shrink-0"
					onClick={copyToClipboard}
					title="Copy model ID"
				>
					{copied ? (
						<Check className="h-3 w-3 text-green-600" />
					) : (
						<Copy className="h-3 w-3" />
					)}
				</Button>
			</div>

			<div className="grid grid-cols-2 gap-2 text-xs">
				<div>
					<span className="text-muted-foreground">Context:</span>
					<span className="ml-1 font-medium">
						{formatContextSize(model.context_length) ?? "—"}
					</span>
				</div>
				<div>
					<span className="text-muted-foreground">Providers:</span>
					<span className="ml-1 font-medium">{model.providers.length}</span>
				</div>
			</div>

			<div className="text-xs space-y-1">
				<div className="text-muted-foreground">Pricing:</div>
				<div className="flex gap-3">
					<span>
						<span className="font-mono font-medium">{model.pricing.input}</span>{" "}
						<span className="text-muted-foreground">in</span>
					</span>
					<span>
						<span className="font-mono font-medium">
							{model.pricing.output}
						</span>{" "}
						<span className="text-muted-foreground">out</span>
					</span>
				</div>
			</div>

			{capabilities.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{capabilities.map((cap) => (
						<Badge
							key={cap}
							variant="outline"
							className="text-[10px] px-1.5 py-0"
						>
							{cap === "Vision" && <Eye className="h-2.5 w-2.5 mr-0.5" />}
							{cap === "Tools" && <Wrench className="h-2.5 w-2.5 mr-0.5" />}
							{cap === "Reasoning" && (
								<Sparkles className="h-2.5 w-2.5 mr-0.5" />
							)}
							{cap === "Image Gen" && (
								<ImageIcon className="h-2.5 w-2.5 mr-0.5" />
							)}
							{cap}
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}

/**
 * Image model card component
 */
function ImageModelCard({ model }: { model: ImageModelData }) {
	const [copied, setCopied] = useState(false);

	const copyToClipboard = async () => {
		try {
			await navigator.clipboard.writeText(model.id);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Ignore errors
		}
	};

	return (
		<div className="flex-shrink-0 w-[260px] rounded-lg border bg-card p-4 space-y-3">
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<h4 className="font-semibold text-sm truncate">{model.name}</h4>
					{model.family && (
						<Badge variant="secondary" className="mt-1 text-[10px]">
							{model.family}
						</Badge>
					)}
				</div>
				<ImageIcon className="h-4 w-4 text-muted-foreground" />
			</div>

			{model.description && (
				<p className="text-xs text-muted-foreground line-clamp-2">
					{model.description}
				</p>
			)}

			<div className="flex items-center gap-2">
				<code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono truncate">
					{model.id}
				</code>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 w-6 p-0 shrink-0"
					onClick={copyToClipboard}
					title="Copy model ID"
				>
					{copied ? (
						<Check className="h-3 w-3 text-green-600" />
					) : (
						<Copy className="h-3 w-3" />
					)}
				</Button>
			</div>

			{model.requestPrice !== undefined && model.requestPrice > 0 && (
				<div className="text-xs">
					<span className="text-muted-foreground">Price:</span>
					<span className="ml-1 font-mono font-medium">
						${model.requestPrice}
					</span>
					<span className="text-muted-foreground"> / request</span>
				</div>
			)}
		</div>
	);
}

/**
 * Models list output component with horizontal scroll
 */
export function ModelsListOutput({ models }: { models: ModelData[] }) {
	return (
		<div className="space-y-2 py-2">
			<div className="flex items-center justify-between px-2">
				<span className="text-xs text-muted-foreground">
					{models.length} model{models.length !== 1 ? "s" : ""} found
				</span>
			</div>
			<ScrollArea className="w-full whitespace-nowrap">
				<div className="flex gap-3 p-2">
					{models.map((model) => (
						<ModelCard key={model.id} model={model} />
					))}
				</div>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>
		</div>
	);
}

/**
 * Image models list output component with horizontal scroll
 */
export function ImageModelsListOutput({
	imageModels,
}: {
	imageModels: ImageModelData[];
}) {
	return (
		<div className="space-y-2 py-2">
			<div className="flex items-center justify-between px-2">
				<span className="text-xs text-muted-foreground">
					{imageModels.length} image model{imageModels.length !== 1 ? "s" : ""}{" "}
					found
				</span>
			</div>
			<ScrollArea className="w-full whitespace-nowrap">
				<div className="flex gap-3 p-2">
					{imageModels.map((model) => (
						<ImageModelCard key={model.id} model={model} />
					))}
				</div>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>
		</div>
	);
}

/**
 * Text content output component for generate_content results
 */
export function TextContentOutput({ response }: { response: string }) {
	return (
		<div className="p-3 rounded-md bg-muted/30 border">
			<div className="prose prose-sm dark:prose-invert max-w-none">
				<div className="whitespace-pre-wrap text-sm">{response}</div>
			</div>
		</div>
	);
}

/**
 * Type guard for generate_content output
 */
export function hasTextContentOutput(output: unknown): output is {
	response: string;
} {
	return (
		typeof output === "object" &&
		output !== null &&
		"response" in output &&
		typeof (output as any).response === "string"
	);
}
