import type { Provider } from "./index.js";

export const providerEnvVarMap: Record<Provider, string> = {
	llmgateway: "LLM_LLMGATEWAY_API_KEY",
	openai: "LLM_OPENAI_API_KEY",
	anthropic: "LLM_ANTHROPIC_API_KEY",
	"google-ai-studio": "LLM_GOOGLE_AI_STUDIO_API_KEY",
	"inference.net": "LLM_INFERENCE_NET_API_KEY",
	"together.ai": "LLM_TOGETHER_AI_API_KEY",
	cloudrift: "LLM_CLOUD_RIFT_API_KEY",
	mistral: "LLM_MISTRAL_API_KEY",
	moonshot: "LLM_MOONSHOT_API_KEY",
	novita: "LLM_NOVITA_AI_API_KEY",
	xai: "LLM_X_AI_API_KEY",
	groq: "LLM_GROQ_API_KEY",
	deepseek: "LLM_DEEPSEEK_API_KEY",
	perplexity: "LLM_PERPLEXITY_API_KEY",
	alibaba: "LLM_ALIBABA_API_KEY",
	nebius: "LLM_NEBIUS_API_KEY",
	zai: "LLM_Z_AI_API_KEY",
	routeway: "LLM_ROUTEWAY_API_KEY",
	"routeway-discount": "LLM_ROUTEWAY_DISCOUNT_API_KEY",
	custom: "LLM_UNUSED",
};

export function getProviderEnvVar(
	provider: Provider | string,
): string | undefined {
	return providerEnvVarMap[provider as Provider];
}

export function hasProviderEnvironmentToken(
	provider: Provider | string,
): boolean {
	const envVar = getProviderEnvVar(provider);
	return envVar ? Boolean(process.env[envVar]) : false;
}
