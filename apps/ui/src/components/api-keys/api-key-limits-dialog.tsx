"use client";

import { useEffect, useState } from "react";

import { useMyMemberBudget } from "@/hooks/useTeam";
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
	organizationId: string;
}

export function ApiKeyLimitsDialog({
	apiKey,
	children,
	onSubmit,
	organizationId,
}: ApiKeyLimitsDialogProps) {
	const [open, setOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [value, setValue] = useState(() => createApiKeyLimitFormValue(apiKey));
	const { data: memberBudgetData } = useMyMemberBudget(organizationId);
	const memberBudget = memberBudgetData?.budget ?? null;

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
