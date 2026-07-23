import { ProviderIcons } from "@llmgateway/shared/components";

import type { ProviderId } from "@llmgateway/models";

export const providerLogoUrls: Partial<
	Record<ProviderId, React.FC<React.SVGProps<SVGSVGElement>>>
> = {
	atlascloud: ProviderIcons.atlascloud,
	openai: ProviderIcons.openai,
	anthropic: ProviderIcons.anthropic,
	elevenlabs: ProviderIcons.elevenlabs,
	"google-ai-studio": ProviderIcons["google-ai-studio"],
	glacier: ProviderIcons.glacier,
	"google-vertex": ProviderIcons["google-vertex"],
	"vertex-anthropic": ProviderIcons["vertex-anthropic"],
	"vertex-openai": ProviderIcons["vertex-openai"],
	quartz: ProviderIcons.quartz,
	"inference.net": ProviderIcons["inference.net"],
	"together-ai": ProviderIcons["together-ai"],
	mistral: ProviderIcons.mistral,
	groq: ProviderIcons.groq,
	xai: ProviderIcons.xai,
	deepseek: ProviderIcons.deepseek,
	perplexity: ProviderIcons.perplexity,
	meta: ProviderIcons.meta,
	moonshot: ProviderIcons.moonshot,
	novita: ProviderIcons.novita,
	alibaba: ProviderIcons.alibaba,
	nebius: ProviderIcons.nebius,
	zai: ProviderIcons.zai,
	nanogpt: ProviderIcons.nanogpt,
	"aws-bedrock": ProviderIcons["aws-bedrock"],
	azure: ProviderIcons.azure,
	"azure-ai-foundry": ProviderIcons["azure-ai-foundry"],
	canopywave: ProviderIcons.canopywave,
	cerebras: ProviderIcons.cerebras,
	minimax: ProviderIcons.minimax,
	bytedance: ProviderIcons.bytedance,
	xiaomi: ProviderIcons.xiaomi,
	embercloud: ProviderIcons.embercloud,
	deepinfra: ProviderIcons.deepinfra,
	reve: ProviderIcons.reve,
	sakana: ProviderIcons.sakana,
	"scx-ai": ProviderIcons["scx-ai"],
	gonka24: ProviderIcons.gonka24,
};

export const getProviderLogoDarkModeClasses = () => {
	return "";
};
