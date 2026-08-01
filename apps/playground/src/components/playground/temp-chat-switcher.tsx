"use client";

import { Check, MessageSquareDashed } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface TempChatSwitcherProps {
	isTemporaryChat: boolean;
	onToggleTemporaryChat: () => void;
	isTemporaryChatToggleDisabled: boolean;
	hasTemporaryMessages: boolean;
}

export function TempChatSwitcher({
	isTemporaryChat,
	onToggleTemporaryChat,
	isTemporaryChatToggleDisabled,
	hasTemporaryMessages,
}: TempChatSwitcherProps) {
	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<motion.div
						animate={
							isTemporaryChat
								? { scale: [1, 1.12, 1], rotate: [0, -8, 0] }
								: { scale: 1, rotate: 0 }
						}
						transition={{
							duration: 0.32,
							ease: "easeOut",
						}}
					>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onToggleTemporaryChat}
							disabled={isTemporaryChatToggleDisabled}
							className="bg-transparent"
							aria-label="Toggle temporary chat"
						>
							<span className="relative flex size-4 items-center justify-center">
								<MessageSquareDashed className="size-4" />
								<AnimatePresence initial={false}>
									{isTemporaryChat ? (
										<motion.span
											key="temporary-check"
											initial={{ scale: 0.45, opacity: 0, rotate: -18 }}
											animate={{ scale: 1, opacity: 1, rotate: 0 }}
											exit={{ scale: 0.45, opacity: 0, rotate: 18 }}
											transition={{ duration: 0.16, ease: "easeOut" }}
											className="absolute inset-0 flex items-center justify-center"
										>
											<Check className="size-2.5 stroke-[3]" />
										</motion.span>
									) : null}
								</AnimatePresence>
							</span>
						</Button>
					</motion.div>
				</TooltipTrigger>
				<TooltipContent>
					{isTemporaryChat ? "Temporary chat is on" : "Start temporary chat"}
				</TooltipContent>
			</Tooltip>
			<AnimatePresence initial={false}>
				{isTemporaryChat && hasTemporaryMessages ? (
					<motion.span
						key="temporary-chat-label"
						initial={{ opacity: 0, x: -6 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: -6 }}
						transition={{ duration: 0.18 }}
						className="text-xs text-muted-foreground hidden sm:inline"
					>
						Temporary Chat
					</motion.span>
				) : null}
			</AnimatePresence>
		</>
	);
}
