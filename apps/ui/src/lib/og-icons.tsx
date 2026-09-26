import {
	AWSBedrockIconStatic,
	FireworksIconStatic,
	getModelFamilyIcon,
	getProviderIcon,
	GoogleStudioAIIconStatic,
	MinimaxIconStatic,
	XAIIconStatic,
} from "@llmgateway/shared/components";

type OgIcon = React.FC<React.SVGProps<SVGSVGElement>>;

// Satori stretches an SVG to the width and height it is given, so the wide
// marks are swapped for their square-viewBox variants before they reach an
// OpenGraph card.
const providerIconOverrides: Record<string, OgIcon | undefined> = {
	"aws-bedrock": AWSBedrockIconStatic,
	"aws-mantle": AWSBedrockIconStatic,
	fireworks: FireworksIconStatic,
	"google-ai-studio": GoogleStudioAIIconStatic,
	minimax: MinimaxIconStatic,
	xai: XAIIconStatic,
};

const familyIconOverrides: Record<string, OgIcon | undefined> = {
	minimax: MinimaxIconStatic,
	xai: XAIIconStatic,
};

export function getOgProviderIcon(providerId: string): OgIcon {
	return providerIconOverrides[providerId] ?? getProviderIcon(providerId);
}

/**
 * Brand mark of the model maker (the model's `family`). Model cards lead with
 * this rather than with a provider mark, so `gpt-5.6-sol` reads as an OpenAI
 * model no matter which provider mapping the card was generated for.
 */
export function getOgModelFamilyIcon(family: string | undefined): OgIcon {
	return (
		(family ? familyIconOverrides[family] : undefined) ??
		getModelFamilyIcon(family ?? "")
	);
}
