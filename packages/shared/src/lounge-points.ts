export const LOUNGE_ACTIVITIES = {
	chat_message: { points: 5, label: "Messages sent", action: "Send a message" },
	chat_created: { points: 10, label: "Chats started", action: "Start a chat" },
	image_generation: {
		points: 10,
		label: "Images created",
		action: "Create an image",
	},
	video_generation: {
		points: 15,
		label: "Videos created",
		action: "Create a video",
	},
	audio_generation: {
		points: 10,
		label: "Audio created",
		action: "Create audio",
	},
	sandbox_escape: {
		points: 25,
		label: "Sandbox escapes",
		action: "Escape the sandbox",
	},
} as const;

export type LoungePointKind = keyof typeof LOUNGE_ACTIVITIES;

export function loungeActivity(kind: string) {
	return Object.entries(LOUNGE_ACTIVITIES).find(([key]) => key === kind)?.[1];
}
