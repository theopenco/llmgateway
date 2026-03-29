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
	DialogTrigger,
} from "@/lib/components/dialog";
import { toast } from "@/lib/components/use-toast";

import {
	ApiKeyLimitFields,
	buildApiKeyLimitPayload,
	createApiKeyLimitFormValue,
	type ApiKeyLimitPayload,
} from "./api-key-limit-fields";

import type { ApiKey } from "@/lib/types";
import type React from "react";

interface ApiKeyLimitsDialogProps {
	apiKey: ApiKey;
	children: React.ReactNode;
	onSubmit: (payload: ApiKeyLimitPayload) => Promise<void> | void;
}

export function ApiKeyLimitsDialog({
	apiKey,
	children,
	onSubmit,
}: ApiKeyLimitsDialogProps) {
	const [open, setOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [value, setValue] = useState(() => createApiKeyLimitFormValue(apiKey));

	useEffect(() => {
		if (!open) {
			setValue(createApiKeyLimitFormValue(apiKey));
		}
	}, [apiKey, open]);

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!isSubmitting) {
					setOpen(nextOpen);
				}
			}}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent>
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						const { error, payload } = buildApiKeyLimitPayload(value);
						if (error) {
							toast({ title: error, variant: "destructive" });
							return;
						}

						setIsSubmitting(true);
						try {
							await onSubmit(payload);
							setOpen(false);
						} catch {
							return;
						} finally {
							setIsSubmitting(false);
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>Edit API key limits</DialogTitle>
						<DialogDescription>
							Update the all-time limit and the recurring usage window for this
							key.
						</DialogDescription>
					</DialogHeader>
					<div className="pt-6">
						<ApiKeyLimitFields
							idPrefix={`api-key-limit-${apiKey.id}`}
							value={value}
							onChange={setValue}
						/>
					</div>
					<DialogFooter className="pt-8">
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting}
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? "Saving..." : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
