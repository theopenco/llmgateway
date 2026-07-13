"use client";

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

interface RenameApiKeyDialogProps {
	apiKey: ApiKey | null;
	isPending?: boolean;
	onConfirm: (description: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

export function RenameApiKeyDialog({
	apiKey,
	isPending = false,
	onConfirm,
	onOpenChange,
	open,
}: RenameApiKeyDialogProps) {
	const [description, setDescription] = useState("");

	useEffect(() => {
		if (open) {
			setDescription(apiKey?.description ?? "");
		}
	}, [open, apiKey?.description]);

	const handleConfirm = async () => {
		const trimmed = description.trim();
		if (!trimmed) {
			toast({
				title: "Enter a name for the API key.",
				variant: "destructive",
			});
			return;
		}

		await onConfirm(trimmed);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Rename API Key</DialogTitle>
					<DialogDescription>
						Choose a new name for this API key. This does not affect the key's
						secret, stats, limits, or IAM rules.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2 py-4">
					<Label htmlFor="rename-api-key-description">Name</Label>
					<Input
						id="rename-api-key-description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						maxLength={255}
						autoFocus
					/>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button type="button" onClick={handleConfirm} disabled={isPending}>
						{isPending ? "Renaming..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
