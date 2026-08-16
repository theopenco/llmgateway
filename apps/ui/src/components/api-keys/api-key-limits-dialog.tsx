"use client";

import { useEffect, useState } from "react";

import { useUser } from "@/hooks/useUser";
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
	validateApiKeyLimitPayloadWithinMemberBudget,
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
	const { user } = useUser();
	// Owners/admins edit keys they did not create, so the cap that applies is the
	// key creator's member budget, not the viewer's own.
	const memberBudget = apiKey.ownerBudget ?? null;
	const budgetOwner = apiKey.createdBy === user?.id ? "self" : "other";
	const ownerName = apiKey.creator?.name ?? apiKey.creator?.email ?? null;

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

						const budgetError = validateApiKeyLimitPayloadWithinMemberBudget(
							payload,
							memberBudget,
							budgetOwner,
						);
						if (budgetError) {
							toast({ title: budgetError, variant: "destructive" });
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
							memberBudget={memberBudget}
							budgetOwner={budgetOwner}
							ownerName={ownerName}
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
