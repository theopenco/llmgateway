/* eslint-disable no-console */
/**
 * Script to export models to models.dev TOML format
 *
 * This script reads all models from the @llmgateway/models package
 * and exports them under the "llmgateway" provider in the TOML format
 * expected by https://github.com/anomalyco/models.dev
 *
 * Usage: npx tsx scripts/export-models-dev.ts
 *
 * Output structure:
 *   exports/providers/llmgateway/
 *     ├── provider.toml
 *     ├── README.md
 *     ├── logo.svg
 *     └── models/
 *         ├── claude-sonnet-4-5.toml
 *         ├── gpt-4o.toml
 *         ├── auto.toml
 *         └── ...
 */

import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { models, type ModelDefinition } from "@llmgateway/models";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUTPUT_DIR = "exports/providers/llmgateway";
const MODELS_DIR = join(OUTPUT_DIR, "models");
const LOGO_SOURCE = join(__dirname, "../../../apps/ui/public/brand/logo-black.svg");

interface ModelsDevModel {
	name: string;
	family?: string;
	release_date: string;
	last_updated: string;
	attachment: boolean;
	reasoning: boolean;
	temperature: boolean;
	knowledge?: string;
	tool_call: boolean;
	structured_output?: boolean;
	open_weights: boolean;
	status?: "alpha" | "beta" | "deprecated";
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
		reasoning?: number;
	};
	limit: {
		context: number;
		input?: number;
		output?: number;
	};
	modalities: {
		input: string[];
		output: string[];
	};
}

function formatDate(date: Date): string {
	return date.toISOString().split("T")[0]!;
}

function escapeTomlString(str: string): string {
	return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function generateProviderToml(): string {
	const lines: string[] = [];
	lines.push(`name = "LLM Gateway"`);
	lines.push(`env = ["LLMGATEWAY_API_KEY"]`);
	lines.push(`npm = "@ai-sdk/openai-compatible"`);
	lines.push(`doc = "https://llmgateway.io/docs"`);
	lines.push(`api = "https://api.llmgateway.io/v1"`);
	return lines.join("\n");
}

function generateLogo(outputPath: string): void {
	const source = readFileSync(LOGO_SOURCE, "utf-8");
	// Extract path elements from the source SVG
	const paths = [...source.matchAll(/<path\s+d="([^"]+)"/g)].map((m) => m[1]);
	// Wrap in a normalized 24x24 / viewBox 0 0 40 40 SVG with currentColor
	// Original viewBox is 0 0 218 232, scale to fit 40x40 (scale by 40/232, center horizontally)
	const scale = 40 / 232;
	const xOffset = (40 - 218 * scale) / 2;
	const lines = [
		`<svg width="24" height="24" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">`,
		`<g transform="translate(${xOffset.toFixed(2)}, 0) scale(${scale.toFixed(5)})">`,
		...paths.map((d) => `<path d="${d}" fill="currentColor"/>`),
		`</g>`,
		`</svg>`,
	];
	writeFileSync(outputPath, lines.join("\n"));
}

function isOpenWeights(modelId: string, family: string): boolean {
	const openWeightsFamilies = ["meta", "mistral", "deepseek", "alibaba", "minimax"];
	const openWeightsPatterns = [/llama/i, /gemma/i, /qwen/i, /mixtral/i, /deepseek/i, /nous/i, /minimax/i];

	if (openWeightsFamilies.includes(family)) {return true;}

	for (const pattern of openWeightsPatterns) {
		if (pattern.test(modelId)) {return true;}
	}

	return false;
}

function getModelFamily(model: ModelDefinition): string {
	// Handle specific model patterns first
	const modelId = model.id.toLowerCase();

	// Gemma models should use "gemma" family, not "gemini"
	if (modelId.includes("gemma")) {
		return "gemma";
	}

	// GPT OSS models should use "gpt-oss" family, not "gpt"
	if (modelId.includes("gpt-oss")) {
		return "gpt-oss";
	}

	// Map internal family names to models.dev enum values
	const familyMap: Record<string, string> = {
		openai: "gpt",
		anthropic: "claude",
		google: "gemini",
		meta: "llama",
		mistral: "mistral",
		deepseek: "deepseek",
		alibaba: "qwen",
		perplexity: "sonar",
		xai: "grok",
		moonshot: "kimi",
		bytedance: "seed",
		zai: "glm",
		nvidia: "nemotron",
		minimax: "minimax",
		llmgateway: "auto",
	};

	return familyMap[model.family] || model.family;
}

function isReasoningModel(model: ModelDefinition): boolean {
	// Check if any provider explicitly has reasoning: true
	if (model.providers.some((p) => p.reasoning === true)) {
		return true;
	}

	// Check if any provider has "reasoning_effort" in supportedParameters
	if (model.providers.some((p) => p.supportedParameters?.includes("reasoning_effort"))) {
		return true;
	}

	// Infer from well-known reasoning model patterns
	const id = model.id.toLowerCase();
	const reasoningPatterns = [
		/^o[134]-/, // o1-*, o3-*, o4-*
		/^o[134]$/, // o1, o3, o4
		/deepseek-r1/, // DeepSeek R1 variants
		/(?<!non-)reasoning/, // models with "reasoning" but not "non-reasoning"
	];

	return reasoningPatterns.some((p) => p.test(id));
}

function generateModelToml(model: ModelDefinition): string | null {
	// Get the first active provider mapping for pricing/capabilities
	const now = new Date();
	const activeProvider = model.providers.find((p) => !p.deactivatedAt || p.deactivatedAt > now);

	if (!activeProvider) {return null;}

	// Check vision across all providers (use first active as primary)
	const hasVision = activeProvider.vision || model.providers.some((p) => p.vision === true);

	const inputModalities: string[] = ["text"];
	if (hasVision) {
		inputModalities.push("image");
	}

	const outputModalities: string[] = model.output?.includes("image") ? ["text", "image"] : ["text"];

	// Determine status
	let status: "alpha" | "beta" | "deprecated" | undefined;
	if (activeProvider.deprecatedAt || model.stability === "deprecated") {
		status = "deprecated";
	} else if (activeProvider.stability === "experimental" || model.stability === "experimental") {
		status = "alpha";
	} else if (
		activeProvider.stability === "unstable" ||
		activeProvider.stability === "beta" ||
		model.stability === "beta" ||
		model.stability === "unstable"
	) {
		status = "beta";
	}

	// Determine reasoning across all providers
	const reasoning = isReasoningModel(model);

	// Check tools and structured output across all providers
	const hasTools = activeProvider.tools === true || model.providers.some((p) => p.tools === true);
	const hasStructuredOutput =
		activeProvider.jsonOutputSchema === true ||
		activeProvider.jsonOutput === true ||
		model.providers.some((p) => p.jsonOutputSchema === true || p.jsonOutput === true);

	// Calculate costs (convert from per-token to per-million-token)
	const inputCost = (activeProvider.inputPrice ?? 0) * 1e6;
	const outputCost = (activeProvider.outputPrice ?? 0) * 1e6;
	const cacheReadCost = activeProvider.cachedInputPrice ? activeProvider.cachedInputPrice * 1e6 : undefined;

	const modelData: ModelsDevModel = {
		name: model.name ?? model.id,
		family: getModelFamily(model),
		release_date: model.releasedAt ? formatDate(model.releasedAt) : "2024-01-01",
		last_updated: model.releasedAt ? formatDate(model.releasedAt) : "2024-01-01",
		attachment: hasVision,
		reasoning,
		temperature: true,
		tool_call: hasTools,
		structured_output: hasStructuredOutput,
		open_weights: isOpenWeights(model.id, model.family),
		status,
		cost: {
			input: Math.round(inputCost * 100) / 100,
			output: Math.round(outputCost * 100) / 100,
			cache_read: cacheReadCost ? Math.round(cacheReadCost * 100) / 100 : undefined,
		},
		limit: {
			context: activeProvider.contextSize ?? 128000,
			output: activeProvider.maxOutput ?? undefined,
		},
		modalities: {
			input: inputModalities,
			output: outputModalities,
		},
	};

	// Build TOML output
	const lines: string[] = [];

	lines.push(`name = "${escapeTomlString(modelData.name)}"`);
	if (modelData.family) {
		lines.push(`family = "${modelData.family}"`);
	}
	lines.push(`release_date = "${modelData.release_date}"`);
	lines.push(`last_updated = "${modelData.last_updated}"`);
	lines.push(`attachment = ${modelData.attachment}`);
	lines.push(`reasoning = ${modelData.reasoning}`);
	lines.push(`temperature = ${modelData.temperature}`);
	lines.push(`tool_call = ${modelData.tool_call}`);
	if (modelData.structured_output !== undefined) {
		lines.push(`structured_output = ${modelData.structured_output}`);
	}
	lines.push(`open_weights = ${modelData.open_weights}`);
	if (modelData.status) {
		lines.push(`status = "${modelData.status}"`);
	}
	lines.push("");

	// Cost section
	lines.push("[cost]");
	lines.push(`input = ${modelData.cost.input.toFixed(2)}`);
	lines.push(`output = ${modelData.cost.output.toFixed(2)}`);
	if (modelData.cost.cache_read !== undefined) {
		lines.push(`cache_read = ${modelData.cost.cache_read.toFixed(2)}`);
	}
	lines.push("");

	// Limit section
	lines.push("[limit]");
	const contextFormatted = modelData.limit.context.toLocaleString("en-US").replace(/,/g, "_");
	lines.push(`context = ${contextFormatted}`);
	// output is required by models.dev schema, default to 16384 if not specified
	const outputLimit = modelData.limit.output ?? 16384;
	const outputFormatted = outputLimit.toLocaleString("en-US").replace(/,/g, "_");
	lines.push(`output = ${outputFormatted}`);
	lines.push("");

	// Modalities section
	lines.push("[modalities]");
	lines.push(`input = [${modelData.modalities.input.map((m) => `"${m}"`).join(", ")}]`);
	lines.push(`output = [${modelData.modalities.output.map((m) => `"${m}"`).join(", ")}]`);

	return lines.join("\n");
}

function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, "-").toLowerCase();
}

function main(): void {
	console.log("Exporting models to models.dev format...\n");

	// Clean and create output directory
	if (existsSync(OUTPUT_DIR)) {
		rmSync(OUTPUT_DIR, { recursive: true });
	}
	mkdirSync(MODELS_DIR, { recursive: true });

	// Write provider.toml
	const providerToml = generateProviderToml();
	writeFileSync(join(OUTPUT_DIR, "provider.toml"), providerToml);
	console.log("Created provider.toml");

	// Write logo.svg (normalized for models.dev: 24x24, viewBox 0 0 40 40, currentColor)
	generateLogo(join(OUTPUT_DIR, "logo.svg"));
	console.log("Created logo.svg");

	// Write model files directly to models/
	let modelCount = 0;
	for (const model of models) {
		const modelToml = generateModelToml(model);
		if (modelToml) {
			const modelFilename = sanitizeFilename(model.id);
			writeFileSync(join(MODELS_DIR, `${modelFilename}.toml`), modelToml);
			modelCount++;
		}
	}

	console.log(`\nExported ${modelCount} models`);
	console.log(`\nOutput written to: ${OUTPUT_DIR}/`);
}

main();
