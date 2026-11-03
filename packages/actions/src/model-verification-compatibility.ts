import type { ProviderModelVerificationTarget } from "@llmgateway/db";

const NATIVE_NON_CHAT_PROVIDERS = new Set([
	"anthropic",
	"vertex-anthropic",
	"azure-anthropic",
	"aws-bedrock",
	"google-ai-studio",
	"google-vertex",
	"quartz",
]);

export function requiresMessageContentVerification(
	target: ProviderModelVerificationTarget,
): boolean {
	if (target.decisions) {
		return false;
	}
	if (target.apiFormat && target.apiFormat !== "provider-native") {
		return target.apiFormat === "openai-chat-completions";
	}
	return !NATIVE_NON_CHAT_PROVIDERS.has(target.providerId);
}
