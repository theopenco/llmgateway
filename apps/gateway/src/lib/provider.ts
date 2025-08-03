import type { Provider } from "@llmgateway/models";

export const providerEnvVarMap: Record<Provider, string> = {
	llmgateway: "LLMGATEWAY_API_KEY",
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	"google-vertex": "VERTEX_API_KEY",
	"google-ai-studio": "GOOGLE_AI_STUDIO_API_KEY",
	"inference.net": "INFERENCE_NET_API_KEY",
	"together.ai": "TOGETHER_AI_API_KEY",
	cloudrift: "CLOUD_RIFT_API_KEY",
	mistral: "MISTRAL_API_KEY",
	moonshot: "MOONSHOT_API_KEY",
	novita: "NOVITA_AI_API_KEY",
	xai: "X_AI_API_KEY",
	groq: "GROQ_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	perplexity: "PERPLEXITY_API_KEY",
	alibaba: "ALIBABA_API_KEY",
	nebius: "NEBIUS_API_KEY",
	zai: "Z_AI_API_KEY",
	custom: "UNUSED",
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
