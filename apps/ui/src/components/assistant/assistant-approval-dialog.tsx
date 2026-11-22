"use client";

import { ShieldCheck } from "lucide-react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";

import type { WebMcpTool } from "@/lib/webmcp";

export interface PendingApproval {
	tool: WebMcpTool;
	toolCallId: string;
	input: Record<string, unknown>;
	/** Where the request was made; the approval is void anywhere else. */
	path: string;
}

function formatValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value);
}

/** The assistant never changes data on its own: every write stops here. */
export function AssistantApprovalDialog({
	approval,
	scope,
	onApprove,
	onDeny,
}: {
	approval: PendingApproval | null;
	scope: string;
	onApprove: (approval: PendingApproval) => void;
	onDeny: (approval: PendingApproval) => void;
}) {
	const entries = approval ? Object.entries(approval.input) : [];
	return (
		<Dialog
			open={!!approval}
			onOpenChange={(open) => {
				if (!open && approval) {
					onDeny(approval);
				}
			}}
		>
			{approval && (
				<DialogContent
					data-testid="assistant-approval-dialog"
					className="overflow-hidden sm:max-w-md"
				>
					<div
						className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500"
						aria-hidden
					/>
					<DialogHeader>
						<div className="mb-1 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] text-amber-600 uppercase dark:text-amber-400">
							<ShieldCheck className="size-4" aria-hidden />
							Autopilot needs your approval
						</div>
						<DialogTitle>{approval.tool.title}</DialogTitle>
						<DialogDescription>
							Autopilot wants to make this change in {scope}. Nothing happens
							until you approve.
						</DialogDescription>
					</DialogHeader>
					{entries.length > 0 && (
						<dl className="bg-muted/50 divide-border divide-y rounded-lg border text-sm">
							{entries.map(([key, value]) => (
								<div key={key} className="flex items-baseline gap-4 px-3 py-2">
									<dt className="text-muted-foreground w-24 shrink-0 font-mono text-xs uppercase">
										{key}
									</dt>
									<dd className="min-w-0 font-medium break-words">
										{formatValue(value)}
									</dd>
								</div>
							))}
						</dl>
					)}
					<DialogFooter>
						<Button
							variant="outline"
							data-testid="assistant-deny"
							onClick={() => onDeny(approval)}
						>
							Deny
						</Button>
						<Button
							data-testid="assistant-approve"
							autoFocus
							onClick={() => onApprove(approval)}
						>
							Approve
						</Button>
					</DialogFooter>
				</DialogContent>
			)}
		</Dialog>
	);
}
