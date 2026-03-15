import { ProviderIcons } from "@llmgateway/shared/components";

import type { ProviderId } from "@llmgateway/models";

export const providerLogoUrls: Partial<
	Record<ProviderId, React.FC<React.SVGProps<SVGSVGElement>>>
> = {
	openai: ProviderIcons.openai,
	anthropic: ProviderIcons.anthropic,
	"google-ai-studio": ProviderIcons["google-ai-studio"],
	"google-vertex": ProviderIcons["google-vertex"],
	"inference.net": ProviderIcons["inference.net"],
	"together.ai": ProviderIcons["together.ai"],
	mistral: ProviderIcons.mistral,
	groq: ProviderIcons.groq,
	xai: ProviderIcons.xai,
	deepseek: ProviderIcons.deepseek,
	perplexity: ProviderIcons.perplexity,
	moonshot: ProviderIcons.moonshot,
	novita: ProviderIcons.novita,
	alibaba: ProviderIcons.alibaba,
	nebius: ProviderIcons.nebius,
	zai: ProviderIcons.zai,
	nanogpt: ProviderIcons.nanogpt,
	"aws-bedrock": ProviderIcons["aws-bedrock"],
	azure: ProviderIcons.azure,
	canopywave: ProviderIcons.canopywave,
	cerebras: ProviderIcons.cerebras,
};

export const getProviderLogoDarkModeClasses = () => {
	return "";
};
