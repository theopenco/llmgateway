import type { CatalogModel } from "@/components/ProviderOptions";

export function supportsRealtimeTranscription(
	mapping: Pick<
		CatalogModel["mappings"][number],
		"realtimeTranscription" | "providerId"
	>,
) {
	// Gemini uses a separate voice protocol without transcription-only sessions.
	return (
		mapping.realtimeTranscription === true &&
		mapping.providerId !== "google-ai-studio"
	);
}
