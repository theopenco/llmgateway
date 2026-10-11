"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/lib/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Textarea } from "@/lib/components/textarea";

export interface PromptMessageDraft {
	role: "system" | "user" | "assistant" | "developer";
	content: string;
}

const ROLES: PromptMessageDraft["role"][] = [
	"system",
	"developer",
	"user",
	"assistant",
];

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function promptDraftVariables(messages: PromptMessageDraft[]): string[] {
	const seen: string[] = [];
	for (const message of messages) {
		const pattern = new RegExp(VARIABLE_PATTERN.source, "g");
		let match = pattern.exec(message.content);
		while (match) {
			if (!seen.includes(match[1])) {
				seen.push(match[1]);
			}
			match = pattern.exec(message.content);
		}
	}
	return seen;
}

export function PromptMessagesEditor({
	messages,
	onChange,
	disabled,
}: {
	messages: PromptMessageDraft[];
	onChange: (messages: PromptMessageDraft[]) => void;
	disabled?: boolean;
}) {
	const update = (index: number, patch: Partial<PromptMessageDraft>) =>
		onChange(
			messages.map((message, i) =>
				i === index ? { ...message, ...patch } : message,
			),
		);

	return (
		<div className="space-y-3">
			{messages.map((message, index) => (
				<div key={index} className="rounded-lg border p-3 space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Select
							value={message.role}
							disabled={disabled}
							onValueChange={(role) =>
								update(index, { role: role as PromptMessageDraft["role"] })
							}
						>
							<SelectTrigger className="w-36" aria-label="Message role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ROLES.map((role) => (
									<SelectItem key={role} value={role}>
										{role}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							disabled={disabled || messages.length === 1}
							aria-label="Remove message"
							onClick={() => onChange(messages.filter((_, i) => i !== index))}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
					<Textarea
						value={message.content}
						disabled={disabled}
						rows={message.role === "system" ? 4 : 3}
						placeholder="Use {{variable}} for values supplied per request"
						className="font-mono text-sm"
						onChange={(event) => update(index, { content: event.target.value })}
					/>
				</div>
			))}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled}
				onClick={() => onChange([...messages, { role: "user", content: "" }])}
			>
				<Plus className="mr-1 h-4 w-4" />
				Add message
			</Button>
		</div>
	);
}
