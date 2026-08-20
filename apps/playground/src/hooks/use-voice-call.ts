"use client";

import { useCallback } from "react";

import { useGeminiRealtimeCall } from "@/hooks/use-gemini-realtime-call";
import { useRealtimeCall } from "@/hooks/use-realtime-call";

import type { RealtimeTranscriptEntry } from "@/hooks/use-realtime-call";

export type {
	RealtimeCallStatus as VoiceCallStatus,
	RealtimeTranscriptEntry as VoiceCallTranscriptEntry,
	RealtimeUsageTotals as VoiceCallUsageTotals,
} from "@/hooks/use-realtime-call";

/**
 * Providers whose realtime sessions speak their own wire protocol rather than
 * OpenAI's. The gateway proxies each protocol natively, so the browser client
 * has to match the provider serving the selected model.
 */
const GEMINI_PROVIDER_ID = "google-ai-studio";

interface UseVoiceCallOptions {
	model: string | null;
	voice: string | null;
	projectId: string | null;
	/**
	 * Provider id of the catalogue mapping serving the selected model. Null
	 * falls back to the OpenAI protocol.
	 */
	provider: string | null;
	onCallError?: (message: string) => void;
}

/**
 * Single entry point for the voice-call UI. Both provider hooks are invoked
 * unconditionally — hooks cannot be called conditionally — but only the one
 * matching the selected model's provider is ever started, and its state and
 * actions are what this facade returns. The idle hook holds no microphone,
 * socket or timer.
 */
export function useVoiceCall({
	model,
	voice,
	projectId,
	provider,
	onCallError,
}: UseVoiceCallOptions) {
	const isGemini = provider === GEMINI_PROVIDER_ID;
	const openaiCall = useRealtimeCall({
		model: isGemini ? null : model,
		voice,
		projectId,
		onCallError,
	});
	const geminiCall = useGeminiRealtimeCall({
		model: isGemini ? model : null,
		voice,
		projectId,
		onCallError,
	});
	const startOpenai = openaiCall.start;
	const startGemini = geminiCall.start;
	// Normalized start: the OpenAI hook accepts a seed transcript to continue a
	// saved call, the Gemini hook does not (BidiGenerateContent has no
	// conversation-item replay yet). Callers gate the continue action on
	// supportsResume, so a seed can never be silently dropped here.
	const start = useCallback(
		(seed?: RealtimeTranscriptEntry[]) => {
			if (isGemini) {
				startGemini();
			} else {
				startOpenai(seed);
			}
		},
		[isGemini, startGemini, startOpenai],
	);
	const active = isGemini ? geminiCall : openaiCall;
	return { ...active, start, supportsResume: !isGemini };
}
