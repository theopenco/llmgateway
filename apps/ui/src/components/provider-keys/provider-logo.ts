import React from "react";

import anthropicLogo from "@/assets/models/anthropic.svg?react";
import CloudRiftLogo from "@/assets/models/cloudrift.svg?react";
import DeepSeekLogo from "@/assets/models/deepseek.svg?react";
import GoogleStudioAiLogo from "@/assets/models/google-studio-ai.svg?react";
import GoogleVertexLogo from "@/assets/models/google-vertex-ai.svg?react";
import GroqLogo from "@/assets/models/groq.svg?react";
import InferenceLogo from "@/assets/models/inference-net.svg?react";
import KlusterLogo from "@/assets/models/kluster-ai.svg?react";
import LLMGatewayLogo from "@/assets/models/llmgateway.svg?react";
import MistralLogo from "@/assets/models/mistral.svg?react";
import MoonshotLogo from "@/assets/models/moonshot.svg?react";
import NovitaLogo from "@/assets/models/novita.svg?react";
import OpenAiLogo from "@/assets/models/openai.svg?react";
import PerplexityLogo from "@/assets/models/perplexity.svg?react";
import TogetherAiLogo from "@/assets/models/together-ai.svg?react";
import XaiLogo from "@/assets/models/xai.svg?react";

import type { ProviderId } from "@llmgateway/models";

// Custom provider logo component
const CustomProviderLogo: React.FC<React.SVGProps<SVGSVGElement>> = (props) => {
	return React.createElement(
		"svg",
		{ viewBox: "0 0 24 24", fill: "currentColor", ...props },
		React.createElement("path", {
			d: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
		}),
	);
};

export const providerLogoComponents: Partial<
	Record<ProviderId, React.FC<React.SVGProps<SVGSVGElement>> | null>
> = {
	llmgateway: LLMGatewayLogo,
	openai: OpenAiLogo,
	anthropic: anthropicLogo,
	"google-vertex": GoogleVertexLogo,
	"inference.net": InferenceLogo,
	"kluster.ai": KlusterLogo,
	"together.ai": TogetherAiLogo,
	"google-ai-studio": GoogleStudioAiLogo,
	cloudrift: CloudRiftLogo,
	mistral: MistralLogo,
	groq: GroqLogo,
	xai: XaiLogo,
	deepseek: DeepSeekLogo,
	perplexity: PerplexityLogo,
	moonshot: MoonshotLogo,
	novita: NovitaLogo,
	custom: CustomProviderLogo,
};
