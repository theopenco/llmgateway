"use client";

import { Button } from "@/components/ui/button";

export function ChatSidebar({
	chats = [],
	currentChatId,
	onNewChat,
	onSelect,
}: {
	chats?: { id: string; title: string }[];
	currentChatId?: string;
	onNewChat?: () => void;
	onSelect?: (id: string) => void;
}) {
	return (
		<div className="w-64 border-r h-full hidden md:flex flex-col">
			<div className="p-3 border-b">
				<Button size="sm" className="w-full" onClick={onNewChat}>
					New chat
				</Button>
			</div>
			<div className="flex-1 overflow-y-auto">
				{chats.length === 0 ? (
					<div className="p-3 text-sm text-muted-foreground">No chats yet</div>
				) : (
					<ul>
						{chats.map((c) => (
							<li key={c.id}>
								<button
									className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${currentChatId === c.id ? "bg-accent" : ""}`}
									onClick={() => onSelect?.(c.id)}
								>
									{c.title}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
