import { gatewayClient } from "@/api/gateway";

import {
	buildDecisionInput,
	isDecisionImageDataUrl,
	normalizeDecisionQuestions,
} from "@llmgateway/shared/decision-studio";

import type { CatalogModel } from "@/components/ProviderOptions";
import type {
	DecisionAnswer,
	DecisionImageMediaType,
	DecisionInputImage,
	DecisionQuestion,
	DecisionUsage,
} from "@llmgateway/shared/decision-studio";

export interface DecisionResult {
	modelId: string;
	modelName: string;
	answers: DecisionAnswer[] | null;
	usage?: DecisionUsage | null;
	error?: string;
}

const imageTypes: Record<string, DecisionImageMediaType> = {
	"image/png": "image/png",
	"image/jpeg": "image/jpeg",
	"image/webp": "image/webp",
	"image/gif": "image/gif",
};

export function decisionImage(
	base64: string,
	mimeType: string,
): DecisionInputImage {
	const mediaType = imageTypes[mimeType];
	if (!mediaType) {
		throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
	}
	const dataUrl = `data:${mediaType};base64,${base64}`;
	if (!isDecisionImageDataUrl(dataUrl)) {
		throw new Error("Choose an image smaller than 1.5 MB.");
	}
	return { dataUrl, mediaType };
}

export function acceptsImages(modelId: string, models: CatalogModel[]) {
	const direct = models.find((model) => model.id === modelId);
	if (direct) {
		return direct.mappings.some((mapping) => mapping.vision === true);
	}
	const [providerId, rest = ""] = modelId.split(/\/(.*)/s);
	const [baseId, region] = rest.split(":");
	return (
		models
			.find((model) => model.id === baseId)
			?.mappings.some(
				(mapping) =>
					mapping.providerId === providerId &&
					(!region || mapping.region === region) &&
					mapping.vision === true,
			) ?? false
	);
}

export async function runDecision(
	projectId: string,
	modelId: string,
	text: string,
	images: DecisionInputImage[],
	questions: DecisionQuestion[],
): Promise<DecisionResult> {
	try {
		const gateway = await gatewayClient(projectId, modelId);
		const { data } = await gateway.POST("/v1/decisions", {
			body: {
				model: modelId,
				input: buildDecisionInput(text, images),
				questions: normalizeDecisionQuestions(questions),
			},
		});
		if (!data?.answers) {
			throw new Error("The model returned no answers. Please try again.");
		}
		return {
			modelId,
			modelName: modelId,
			answers: data.answers,
			usage: data.usage ?? null,
		};
	} catch (error) {
		return {
			modelId,
			modelName: modelId,
			answers: null,
			error: error instanceof Error ? error.message : "The decision failed.",
		};
	}
}

export function decisionCurl(
	modelId: string,
	text: string,
	imageCount: number,
	questions: DecisionQuestion[],
) {
	const body = {
		model: modelId,
		input: buildDecisionInput(
			text,
			Array.from({ length: imageCount }, () => ({
				dataUrl: "data:image/png;base64,…",
				mediaType: "image/png" as const,
			})),
		),
		questions: normalizeDecisionQuestions(questions),
	};
	return [
		'curl -X POST "https://api.llmgateway.io/v1/decisions" \\',
		'  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\',
		'  -H "Content-Type: application/json" \\',
		`  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`,
	].join("\n");
}
