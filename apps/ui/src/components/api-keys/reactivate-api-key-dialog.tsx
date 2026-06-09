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
import { toast } from "@/lib/components/use-toast";

import {
	ApiKeyTtlFields,
	buildApiKeyTtlExpiresAt,
	createApiKeyTtlFormValue,
} from "./api-key-ttl-fields";

import type { ApiKey } from "@/lib/types";

interface ReactivateApiKeyDialogProps {
	apiKey: ApiKey | null;
	isPending?: boolean;
	onConfirm: (expiresAt: string) => Promise<void> | void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

export function ReactivateApiKeyDialog({
	apiKey,
	isPending = false,
	onConfirm,
	onOpenChange,
	open,
}: ReactivateApiKeyDialogProps) {
	const [ttlValue, setTtlValue] = useState(() =>
		createApiKeyTtlFormValue(true),
	);

	useEffect(() => {
		if (open) {
			setTtlValue(createApiKeyTtlFormValue(true));
		}
	}, [open]);

	const handleConfirm = async () => {
		const { error, expiresAt } = buildApiKeyTtlExpiresAt(ttlValue);
		if (error || !expiresAt) {
			toast({
				title: error ?? "Set a future expiration date.",
				variant: "destructive",
			});
			return;
		}

		await onConfirm(expiresAt);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Reactivate API Key</DialogTitle>
					<DialogDescription>
						{apiKey?.description ? `"${apiKey.description}" ` : "This key "}
						has expired. Set a new expiration to bring it back online.
					</DialogDescription>
				</DialogHeader>
				<div className="py-4">
					<ApiKeyTtlFields
						idPrefix="reactivate-api-key"
						lockEnabled
						value={ttlValue}
						onChange={setTtlValue}
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
						{isPending ? "Reactivating..." : "Reactivate Key"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
