/**
 * Helpers shared by the realtime call surface and its saved-call history.
 */

const MAX_TITLE_LENGTH = 60;

export function formatCallDuration(totalSeconds: number): string {
	const safeSeconds = Number.isFinite(totalSeconds)
		? Math.max(0, Math.floor(totalSeconds))
		: 0;
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Label a saved call by what the caller opened with, falling back to the
 * assistant's first turn when the user's opening transcription is empty (the
 * transcription model can drop a short "hey").
 */
export function deriveCallTitle(
	entries: { role: "user" | "assistant"; text: string }[],
): string {
	const spoken = entries.filter((entry) => entry.text.trim().length > 0);
	const source = spoken.find((entry) => entry.role === "user") ?? spoken[0];
	const text = source?.text.trim() ?? "";
	if (!text) {
		return "Voice call";
	}
	return text.length > MAX_TITLE_LENGTH
		? `${text.slice(0, MAX_TITLE_LENGTH)}…`
		: text;
}
