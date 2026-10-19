"use client";

import { Info } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

import type { CallTranscription } from "@/lib/realtime-transcription";

interface CallTranscriptionSelectProps {
	transcription: CallTranscription | null;
	disabled: boolean;
	onValueChange: (value: string) => void;
}

export function CallTranscriptionSelect({
	transcription,
	disabled,
	onValueChange,
}: CallTranscriptionSelectProps) {
	if (!transcription) {
		return null;
	}
	switch (transcription.kind) {
		case "native":
			return null;
		case "unavailable":
			return (
				<span className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
					Transcription unavailable
					<Tooltip>
						<TooltipTrigger asChild>
							<Info
								className="size-3.5"
								aria-label="About transcription availability"
							/>
						</TooltipTrigger>
						<TooltipContent className="max-w-64">
							This provider has no active transcription model, so calls
							can&apos;t start.
						</TooltipContent>
					</Tooltip>
				</span>
			);
		case "asr":
			return (
				<div className="flex items-center gap-2">
					<Label
						htmlFor="realtime-call-transcription"
						className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap"
					>
						<span className="sr-only 2xl:not-sr-only">Transcription</span>
						<Tooltip>
							<TooltipTrigger asChild>
								<Info className="size-3.5" aria-label="About transcription" />
							</TooltipTrigger>
							<TooltipContent className="max-w-64">
								The transcription model turns your speech into the transcript.
								It is billed separately from the call.
							</TooltipContent>
						</Tooltip>
					</Label>
					<Select
						value={transcription.selected.model}
						onValueChange={onValueChange}
						disabled={disabled}
					>
						<SelectTrigger
							id="realtime-call-transcription"
							className="w-[210px]"
						>
							{/* Explicit value text keeps the prices out of the closed
							    trigger. */}
							<SelectValue>{transcription.selected.label}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{transcription.options.map((option) => (
								<SelectItem
									key={option.model}
									value={option.model}
									textValue={option.label}
								>
									<span className="flex flex-col gap-0.5 py-0.5">
										<span>{option.label}</span>
										{option.priceLabel && (
											<span className="text-muted-foreground text-xs">
												{option.priceLabel}
											</span>
										)}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			);
		default: {
			const unhandled: never = transcription;
			return unhandled;
		}
	}
}
