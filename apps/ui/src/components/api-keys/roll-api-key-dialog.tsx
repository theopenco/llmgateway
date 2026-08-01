"use client";

import { Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";

import type { ApiKey } from "@/lib/types";

interface RollApiKeyDialogProps {
	apiKey: ApiKey | null;
	isPending?: boolean;
	onConfirm: () => Promise<string | undefined> | string | undefined;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

export function RollApiKeyDialog({
	apiKey,
	isPending = false,
	onConfirm,
	onOpenChange,
	open,
}: RollApiKeyDialogProps) {
	const [newToken, setNewToken] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setNewToken(null);
		}
	}, [open]);

	const handleConfirm = async () => {
		const token = await onConfirm();
		if (token) {
			setNewToken(token);
		}
	};

	const copyToClipboard = () => {
		if (!newToken) {
			return;
		}
		void navigator.clipboard.writeText(newToken);
		toast({
			title: "API Key Copied",
			description: "The new API key has been copied to your clipboard.",
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				{newToken ? (
					<>
						<DialogHeader>
							<DialogTitle>API Key Rolled</DialogTitle>
							<DialogDescription>
								A new secret has been generated. Please copy it now as you won't
								be able to see it again. All stats, limits, and settings for
								this key are preserved.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="rolled-api-key">API Key</Label>
								<div className="flex items-center space-x-2">
									<Input
										id="rolled-api-key"
										value={newToken}
										readOnly
										className="font-mono text-xs"
									/>
									<Button
										variant="outline"
										size="icon"
										onClick={copyToClipboard}
									>
										<Copy className="h-4 w-4" />
										<span className="sr-only">Copy API key</span>
									</Button>
								</div>
								<p className="text-muted-foreground text-xs">
									Make sure to update any clients using the old secret. The
									previous secret no longer works.
								</p>
							</div>
							<DialogFooter>
								<Button onClick={() => onOpenChange(false)}>Done</Button>
							</DialogFooter>
						</div>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Roll API Key</DialogTitle>
							<DialogDescription>
								This generates a new secret for{" "}
								{apiKey?.description ? `"${apiKey.description}"` : "this key"}{" "}
								and immediately invalidates the current one. The key's stats,
								limits, IAM rules, and other settings are kept intact.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isPending}
							>
								Cancel
							</Button>
							<Button
								type="button"
								onClick={handleConfirm}
								disabled={isPending}
							>
								{isPending ? "Rolling..." : "Roll Key"}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
