"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { ChatSupportTrigger } from "@/components/chat-support-trigger";

const loadChatSupport = () => import("@/components/chat-support");

const ChatSupport = dynamic(
	() => loadChatSupport().then((mod) => mod.ChatSupport),
	{
		ssr: false,
		loading: () => <ChatSupportTrigger isOpen={false} hasUnread={false} />,
	},
);

export function ChatSupportLauncher() {
	const [requested, setRequested] = useState(false);

	if (requested) {
		return <ChatSupport defaultOpen />;
	}

	return (
		<ChatSupportTrigger
			isOpen={false}
			hasUnread={false}
			onClick={() => setRequested(true)}
			onPointerEnter={() => void loadChatSupport()}
			onFocus={() => void loadChatSupport()}
		/>
	);
}
