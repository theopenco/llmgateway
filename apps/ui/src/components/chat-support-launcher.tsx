"use client";

import { useState } from "react";

import { ChatSupportTrigger } from "@/components/chat-support-trigger";
import { toast } from "@/lib/components/use-toast";

import type { ChatSupport as ChatSupportComponent } from "@/components/chat-support";

const loadChatSupport = () =>
	import("@/components/chat-support").then((mod) => mod.ChatSupport);

export function ChatSupportLauncher() {
	const [ChatSupport, setChatSupport] = useState<
		typeof ChatSupportComponent | null
	>(null);
	const [loading, setLoading] = useState(false);

	const prefetch = () => {
		loadChatSupport().catch((error: unknown) => {
			console.error("Failed to prefetch chat support:", error);
		});
	};

	const open = () => {
		if (loading) {
			return;
		}
		setLoading(true);
		loadChatSupport()
			.then((component) => setChatSupport(() => component))
			.catch((error: unknown) => {
				console.error("Failed to load chat support:", error);
				toast({
					title: "Chat support failed to load. Please try again.",
					variant: "destructive",
				});
			})
			.finally(() => setLoading(false));
	};

	if (ChatSupport) {
		return <ChatSupport defaultOpen />;
	}

	return (
		<ChatSupportTrigger
			isOpen={false}
			hasUnread={false}
			aria-busy={loading}
			onClick={open}
			onPointerEnter={prefetch}
			onFocus={prefetch}
		/>
	);
}
