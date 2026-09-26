import { client } from "@/api/client";

import type { SavedCall } from "@/lib/call-transcript";
import type { VoiceState } from "@/lib/voice-session";

export interface PendingCall {
	organizationId: string;
	resumeId?: string;
	state: VoiceState;
}

export function callEntries(
	state: VoiceState,
	onlyNew = false,
): SavedCall["transcript"] {
	return state.transcript
		.filter(
			(entry) =>
				(!onlyNew || !entry.id.startsWith("seed-")) &&
				(entry.text.trim() || entry.audio),
		)
		.map(({ role, text, status, timestamp, audio }) => ({
			role,
			text,
			status,
			timestamp,
			...(audio ? { audio } : {}),
		}));
}

export async function saveCall(pending: PendingCall) {
	const { state, resumeId, organizationId } = pending;
	if (!state.selection) {
		throw new Error("The call has no model selection.");
	}
	const transcript = callEntries(state, Boolean(resumeId));
	if (!transcript.length) {
		throw new Error("There is no new conversation to save.");
	}
	if (resumeId) {
		const { data } = await client.PATCH("/playground/realtime-history/{id}", {
			params: { path: { id: resumeId } },
			body: {
				appendTranscript: transcript,
				addDurationSeconds: state.elapsed,
				addUsage: state.usage,
			},
		});
		if (!data?.item) {
			throw new Error("The saved call was not returned.");
		}
		return data.item.id;
	}
	const title = (
		transcript.find((entry) => entry.role === "user" && entry.text.trim())
			?.text ||
		transcript.find((entry) => entry.text.trim())?.text ||
		"Voice call"
	).slice(0, 100);
	const { data } = await client.POST("/playground/realtime-history", {
		body: {
			organizationId,
			title,
			model: state.selection.model,
			...(state.selection.voice ? { voice: state.selection.voice } : {}),
			durationSeconds: state.elapsed,
			transcript,
			usage: state.usage,
		},
	});
	if (!data?.item) {
		throw new Error("The saved call was not returned.");
	}
	return data.item.id;
}
