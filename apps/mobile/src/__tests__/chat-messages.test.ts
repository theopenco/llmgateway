import {
	completionMessage,
	readChatMessage,
	storedAttachments,
} from "@/api/chat-messages";

import type { Attachment } from "@/api/chat-messages";

const attachments: Attachment[] = [
	{
		id: "image",
		name: "photo.jpg",
		mediaType: "image/jpeg",
		url: "data:image/jpeg;base64,aW1hZ2U=",
	},
	{
		id: "audio",
		name: "voice.wav",
		mediaType: "audio/wav",
		url: "data:audio/wav;base64,YXVkaW8=",
	},
	{
		id: "file",
		name: "notes.pdf",
		mediaType: "application/pdf",
		url: "data:application/pdf;base64,cGRm",
	},
];
const message = {
	id: "message",
	role: "user" as const,
	content: "Explain these",
	images: null,
	audios: null,
	documents: null,
	reasoning: null,
	tools: null,
	sources: null,
	metadata: null,
	sequence: 1,
	createdAt: "2026-01-01T00:00:00.000Z",
};

test("restores all attachment types in the format shared with web conversations", () => {
	const saved = readChatMessage({
		...message,
		...storedAttachments(attachments),
	});
	expect(
		completionMessage(saved.role, saved.content ?? "", saved.attachments),
	).toEqual({
		role: "user",
		content: [
			{ type: "text", text: "Explain these" },
			{ type: "image_url", image_url: { url: attachments[0].url } },
			{ type: "input_audio", input_audio: { data: "YXVkaW8=", format: "wav" } },
			{
				type: "file",
				file: { filename: "notes.pdf", file_data: attachments[2].url },
			},
		],
	});
	expect(saved.attachments[0].name).toBe("Image 1.jpg");
});

test("supports attachment-only prompts without empty text parts", () => {
	expect(completionMessage("user", "", [attachments[0]])).toEqual({
		role: "user",
		content: [{ type: "image_url", image_url: { url: attachments[0].url } }],
	});
});

test.each(["not json", '[{"image_url":{}}]'])(
	"rejects unreadable saved attachments instead of dropping context: %s",
	(images) => {
		expect(() => readChatMessage({ ...message, images })).toThrow(
			"saved attachment could not be read",
		);
	},
);

test("rejects unsupported audio before sending incomplete context", () => {
	expect(() =>
		completionMessage("user", "", [
			{ ...attachments[1], mediaType: "audio/unknown" },
		]),
	).toThrow("supported audio file");
});
