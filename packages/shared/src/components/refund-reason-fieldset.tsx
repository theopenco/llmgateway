"use client";

import {
	REFUND_COMMENTS_MAX_LENGTH,
	REFUND_REASON_ASSURANCE,
	REFUND_REASON_HEADING,
	REFUND_REASON_OPTIONS,
	refundCommentsRequired,
	type RefundReason,
} from "@/refunds.js";

import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export interface RefundReasonFieldsetProps {
	// Scopes the radio group name and input ids so several refund dialogs can
	// coexist on one page (a transactions table renders one per row).
	idPrefix: string;
	reason: RefundReason | null;
	onReasonChange: (reason: RefundReason) => void;
	comments: string;
	onCommentsChange: (comments: string) => void;
	disabled?: boolean;
}

/**
 * The "why are you refunding?" question shared by the credits, DevPass and chat
 * refund dialogs: a required one-click category, then a follow-up question
 * chosen from that category. The follow-up only appears once a reason is
 * picked, which keeps the dialog short and makes the question feel like a
 * reply rather than a form field.
 *
 * The chips are native radios styled through `peer-checked:`, so arrow-key
 * navigation and screen-reader semantics come for free.
 */
export function RefundReasonFieldset({
	idPrefix,
	reason,
	onReasonChange,
	comments,
	onCommentsChange,
	disabled,
}: RefundReasonFieldsetProps) {
	const selectedReason = REFUND_REASON_OPTIONS.find(
		(option) => option.value === reason,
	);

	return (
		<fieldset className="space-y-3" disabled={disabled}>
			<legend className="text-sm font-medium">{REFUND_REASON_HEADING}</legend>
			<p className="text-muted-foreground text-xs">{REFUND_REASON_ASSURANCE}</p>
			<div className="flex flex-wrap gap-2">
				{REFUND_REASON_OPTIONS.map((option) => (
					<label key={option.value} className="cursor-pointer">
						<input
							type="radio"
							name={`refund-reason-${idPrefix}`}
							value={option.value}
							checked={reason === option.value}
							onChange={() => onReasonChange(option.value)}
							className="peer sr-only"
						/>
						<span className="peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:hover:bg-primary peer-focus-visible:ring-ring/50 hover:bg-muted text-muted-foreground block rounded-full border px-3 py-1.5 text-sm transition-colors peer-focus-visible:ring-[3px]">
							{option.label}
						</span>
					</label>
				))}
			</div>
			{selectedReason ? (
				<div className="space-y-2">
					<Label htmlFor={`refund-comments-${idPrefix}`}>
						{selectedReason.prompt}
						{refundCommentsRequired(selectedReason.value) ? null : (
							<span className="text-muted-foreground font-normal">
								(optional)
							</span>
						)}
					</Label>
					<Textarea
						id={`refund-comments-${idPrefix}`}
						value={comments}
						onChange={(e) => onCommentsChange(e.target.value)}
						maxLength={REFUND_COMMENTS_MAX_LENGTH}
						rows={3}
						placeholder={selectedReason.placeholder}
					/>
				</div>
			) : null}
		</fieldset>
	);
}
