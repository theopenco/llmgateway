import {
	Key,
	Zap,
	MessageSquare,
	Trash2,
	Infinity as InfinityIcon,
	ExternalLink,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";

interface UpgradeDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRequestApiKey?: () => void;
	trigger?: "chat_limit" | "message_limit" | "delete_blocked";
}

export function UpgradeDialog({
	open,
	onOpenChange,
	onRequestApiKey,
	trigger = "chat_limit",
}: UpgradeDialogProps) {
	const handleClose = () => {
		onOpenChange(false);
	};

	const handleAddApiKey = () => {
		onRequestApiKey?.();
		onOpenChange(false);
	};

	const triggerContent = {
		chat_limit: {
			title: "Chat Limit Reached",
			description: "You've reached the maximum of 3 free chats.",
			icon: <MessageSquare className="h-6 w-6 text-muted-foreground" />,
		},
		message_limit: {
			title: "Message Limit Reached",
			description: "You've reached the 1 prompt/answer limit for this chat.",
			icon: <MessageSquare className="h-6 w-6 text-muted-foreground" />,
		},
		delete_blocked: {
			title: "Delete Chats Unavailable",
			description: "Chat deletion is not available with the free tier.",
			icon: <Trash2 className="h-6 w-6 text-muted-foreground" />,
		},
	};

	const content = triggerContent[trigger];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{content.icon}
						{content.title}
					</DialogTitle>
					<DialogDescription className="text-base leading-relaxed">
						{content.description}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Current limitations */}
					<div className="rounded-lg border p-4 bg-muted/30 border-muted-foreground/20">
						<h4 className="font-medium mb-3 flex items-center gap-2 text-foreground">
							<Badge variant="outline" className="border-muted-foreground/20">
								Free Tier
							</Badge>
							Current Limitations
						</h4>
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li className="flex items-center gap-2">
								<MessageSquare className="h-4 w-4" />
								Maximum of 3 chats
							</li>
							<li className="flex items-center gap-2">
								<MessageSquare className="h-4 w-4" />1 prompt/answer per chat
							</li>
							<li className="flex items-center gap-2">
								<Trash2 className="h-4 w-4" />
								Cannot delete chats
							</li>
						</ul>
					</div>

					{/* Upgrade benefits */}
					<div className="rounded-lg border p-4 bg-foreground/5 border-muted-foreground/20">
						<h4 className="font-medium mb-3 flex items-center gap-2 text-foreground">
							<Zap className="h-4 w-4 text-foreground" />
							Unlock with Your API Key
						</h4>
						<ul className="space-y-2 text-sm text-foreground">
							<li className="flex items-center gap-2">
								<InfinityIcon className="h-4 w-4 text-foreground" />
								Unlimited chats
							</li>
							<li className="flex items-center gap-2">
								<InfinityIcon className="h-4 w-4 text-foreground" />
								Unlimited messages per chat
							</li>
							<li className="flex items-center gap-2">
								<Trash2 className="h-4 w-4 text-foreground" />
								Delete chats anytime
							</li>
							<li className="flex items-center gap-2">
								<Key className="h-4 w-4 text-foreground" />
								Use your own LLM Gateway API key
							</li>
						</ul>
					</div>

					{/* Instructions */}
					<div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
						<h4 className="font-medium mb-2 flex items-center gap-2 text-blue-800 dark:text-blue-200">
							<ExternalLink className="h-4 w-4" />
							How to get your API key:
						</h4>
						<ol className="list-decimal list-inside space-y-1 text-sm text-blue-700 dark:text-blue-300">
							<li>
								Visit{" "}
								<a
									href="https://llmgateway.io"
									target="_blank"
									rel="noopener noreferrer"
									className="underline hover:no-underline"
								>
									llmgateway.io
								</a>
							</li>
							<li>Create an account or sign in</li>
							<li>Navigate to the API Keys section</li>
							<li>Generate a new API key</li>
							<li>Add it to the playground</li>
						</ol>
					</div>

					<div className="text-center space-y-2">
						<p className="text-sm text-muted-foreground">
							Add your LLM Gateway API key to unlock unlimited features.
						</p>
						<p className="text-xs text-muted-foreground">
							You can also manage your account in{" "}
							<Link
								href="/dashboard"
								className="text-foreground hover:underline font-medium"
								prefetch={true}
							>
								The Dashboard
							</Link>
							.
						</p>
					</div>
				</div>

				<DialogFooter className="gap-2">
					<Button type="button" variant="outline" onClick={handleClose}>
						Maybe Later
					</Button>
					<Button onClick={handleAddApiKey} className="gap-2">
						<Key className="h-4 w-4" />
						Add API Key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
