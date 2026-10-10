import { pcm16ChunksToWavBase64 } from "@llmgateway/shared/realtime-pcm";

import type { paths } from "@/lib/api/v1";

export type SavedCall =
	paths["/playground/realtime-history/{id}"]["get"]["responses"][200]["content"]["application/json"]["item"];
export type CallUsage = NonNullable<SavedCall["usage"]>;
type SavedCallEntry = SavedCall["transcript"][number];
export interface CallEntry extends SavedCallEntry {
	id: string;
}
export function emptyCallUsage(): CallUsage {
	return {
		responses: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		audioInputTokens: 0,
		audioOutputTokens: 0,
	};
}
export const MAX_CALL_AUDIO_BYTES = 24 * 1024 * 1024;
export class CallAudioArchive {
	private bytes: number;
	private chunks = new Map<string, string[]>();
	public limited: boolean;
	public constructor(
		seed: CallEntry[] = [],
		private readonly limit = MAX_CALL_AUDIO_BYTES,
	) {
		this.bytes = seed.reduce(
			(total, entry) =>
				total +
				(entry.audio ? Math.ceil((entry.audio.base64.length * 3) / 4) : 0),
			0,
		);
		this.limited = this.bytes >= limit;
	}
	public add(itemId: string, audio: string) {
		if (this.limited) {
			return;
		}
		this.bytes += Math.ceil((audio.length * 3) / 4);
		if (this.bytes >= this.limit) {
			this.limited = true;
			this.chunks.clear();
			return;
		}
		const chunks = this.chunks.get(itemId) ?? [];
		chunks.push(audio);
		this.chunks.set(itemId, chunks);
	}
	public finalize(entries: CallEntry[]) {
		const result = entries.map((entry) => {
			const chunks = this.chunks.get(entry.id);
			return chunks?.length
				? {
						...entry,
						audio: {
							base64: pcm16ChunksToWavBase64(chunks),
							mediaType: "audio/wav" as const,
						},
					}
				: entry;
		});
		this.chunks.clear();
		return result;
	}
}
