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

import { mkdirSync, writeFileSync, existsSync, rmSync, copyFileSync } from "fs";
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

function generateReadme(): string {
	return `# LLM Gateway Provider

This provider enables access to 150+ AI models through [LLM Gateway](https://llmgateway.io), an OpenAI-compatible API gateway that provides unified access to 40+ LLM providers.

## Directory Structure

- **models/**: TOML configuration files for all supported models
- **provider.toml**: Provider configuration
- **logo.svg**: Provider logo

## Regenerating Models

Model configurations are generated from the [LLM Gateway repository](https://github.com/theopenco/llmgateway):

\`\`\`bash
npx tsx scripts/export-models-dev.ts
\`\`\`

## How It Works

LLM Gateway acts as a unified proxy for multiple AI providers. You can access any supported model through a single API endpoint using your LLM Gateway API key.

## Prerequisites

\`\`\`bash
export LLMGATEWAY_API_KEY="your-api-key"
\`\`\`

## Supported Providers

- OpenAI (GPT-3.5, GPT-4, GPT-4o, GPT-5, o1, o3, o4-mini)
- Anthropic (Claude 3, 3.5, 3.7, 4, 4.5)
- Google (Gemini 1.5, 2.0, 2.5, 3, Gemma)
- Meta (Llama 3.1, 3.3, 4)
- xAI (Grok 2, 3, 4)
- DeepSeek (V3, R1)
- Alibaba (Qwen Max, Plus, Flash, VL, Coder)
- Mistral (Large, Pixtral, Mixtral)
- ZAI (GLM 4.5, 4.6, 4.7)
- ByteDance (Seed, Seedream)
- Moonshot (Kimi K2)
- Perplexity (Sonar)
- And many more...

## Usage with AI SDK

\`\`\`typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const llmgateway = createOpenAICompatible({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLMGATEWAY_API_KEY,
});

const result = await generateText({
  model: llmgateway("claude-sonnet-4-5"),
  prompt: "Hello!",
});
\`\`\`

## Links

- [Documentation](https://llmgateway.io/docs)
- [Pricing](https://llmgateway.io/pricing)
- [GitHub](https://github.com/theopenco/llmgateway)
`;
}

function isOpenWeights(modelId: string, family: string): boolean {
	const openWeightsFamilies = ["meta", "mistral", "deepseek", "alibaba"];
	const openWeightsPatterns = [/llama/i, /gemma/i, /qwen/i, /mixtral/i, /deepseek/i, /nous/i];

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

function generateModelToml(model: ModelDefinition): string | null {
	// Get the first active provider mapping for pricing/capabilities
	const now = new Date();
	const activeProvider = model.providers.find((p) => !p.deactivatedAt || p.deactivatedAt > now);

	if (!activeProvider) {return null;}

	const inputModalities: string[] = ["text"];
	if (activeProvider.vision) {
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

	// Calculate costs (convert from per-token to per-million-token)
	const inputCost = (activeProvider.inputPrice ?? 0) * 1e6;
	const outputCost = (activeProvider.outputPrice ?? 0) * 1e6;
	const cacheReadCost = activeProvider.cachedInputPrice ? activeProvider.cachedInputPrice * 1e6 : undefined;

	const modelData: ModelsDevModel = {
		name: model.name ?? model.id,
		family: getModelFamily(model),
		release_date: model.releasedAt ? formatDate(model.releasedAt) : "2024-01-01",
		last_updated: model.releasedAt ? formatDate(model.releasedAt) : "2024-01-01",
		attachment: activeProvider.vision ?? false,
		reasoning: activeProvider.reasoning ?? false,
		temperature: true,
		tool_call: activeProvider.tools ?? false,
		structured_output: activeProvider.jsonOutputSchema ?? activeProvider.jsonOutput ?? false,
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

	// Write README.md
	const readme = generateReadme();
	writeFileSync(join(OUTPUT_DIR, "README.md"), readme);
	console.log("Created README.md");

	// Copy logo.svg
	copyFileSync(LOGO_SOURCE, join(OUTPUT_DIR, "logo.svg"));
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
