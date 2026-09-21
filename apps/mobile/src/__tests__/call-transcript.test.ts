import { CallAudioArchive } from "@/lib/call-transcript";

import { base64ToBytes } from "@llmgateway/shared/realtime-pcm";

import type { CallEntry } from "@/lib/call-transcript";

const entry: CallEntry = {
	id: "one",
	role: "assistant",
	text: "Hello",
	timestamp: 1,
	status: "final",
};
test("stores mono PCM WAV with all chunks and preserves completed clips across later turns", () => {
	const archive = new CallAudioArchive();
	archive.add("one", "AQACAA==");
	archive.add("one", "AwAEAA==");
	const result = archive.finalize([entry]);
	const bytes = base64ToBytes(result[0].audio!.base64);
	expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
	expect([...bytes.slice(44)]).toEqual([1, 0, 2, 0, 3, 0, 4, 0]);
	expect(archive.finalize(result)).toEqual(result);
});
test("caps accumulated call audio without dropping the transcript or saved clips", () => {
	const seed = {
		...entry,
		audio: { base64: "AAAA", mediaType: "audio/wav" as const },
	};
	const archive = new CallAudioArchive([seed], 10);
	archive.add("two", "AAAA");
	archive.add("two", "AAAA");
	archive.add("two", "AAAA");
	expect(archive.limited).toBe(true);
	const entries = [seed, { ...entry, id: "two", text: "Still transcribed" }];
	expect(archive.finalize(entries)).toEqual(entries);
});
