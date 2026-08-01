"use client";

import { AudioLines, Loader2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getModelAudioConfig } from "@/lib/audio-gen";

import type { AudioFormat } from "@/lib/audio-gen";

interface AudioControlsProps {
	prompt: string;
	setPrompt: (prompt: string) => void;
	selectedModels: string[];
	voice: string;
	setVoice: (value: string) => void;
	audioFormat: AudioFormat;
	setAudioFormat: (value: AudioFormat) => void;
	speed: number;
	setSpeed: (value: number) => void;
	instructions: string;
	setInstructions: (value: string) => void;
	isGenerating: boolean;
	onGenerate: () => void;
}

export function AudioControls({
	prompt,
	setPrompt,
	selectedModels,
	voice,
	setVoice,
	audioFormat,
	setAudioFormat,
	speed,
	setSpeed,
	instructions,
	setInstructions,
	isGenerating,
	onGenerate,
}: AudioControlsProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Derive config from first selected model (settings apply globally)
	const primaryModel = selectedModels[0] ?? "";
	const config = getModelAudioConfig(primaryModel);

	const canGenerate = prompt.trim().length > 0 && selectedModels.length > 0;

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (prompt.trim() && !isGenerating && canGenerate) {
				onGenerate();
			}
		}
	};

	return (
		<div className="border-b bg-background p-4">
			<div className="max-w-4xl mx-auto space-y-3">
				<div className="rounded-md border-input border dark:bg-input/30 shadow-xs focus-within:ring-1 focus-within:ring-ring transition-colors">
					<Textarea
						ref={textareaRef}
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Enter the text you want to turn into speech..."
						className="min-h-[80px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent focus-visible:ring-0 shadow-none"
						disabled={isGenerating}
					/>
				</div>
				{config.supportsInstructions && (
					<Input
						value={instructions}
						onChange={(e) => setInstructions(e.target.value)}
						placeholder="Optional style instructions, e.g. 'Speak in a warm, friendly tone'"
						disabled={isGenerating}
					/>
				)}
				<div className="flex flex-wrap items-center gap-2">
					<Select value={voice} onValueChange={setVoice}>
						<SelectTrigger size="sm" className="min-w-[130px]">
							<SelectValue placeholder="Voice" />
						</SelectTrigger>
						<SelectContent>
							{config.voices.map((v) => (
								<SelectItem key={v} value={v}>
									{v.charAt(0).toUpperCase() + v.slice(1)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{config.availableFormats.length > 1 && (
						<Select
							value={audioFormat}
							onValueChange={(val) => setAudioFormat(val as AudioFormat)}
						>
							<SelectTrigger size="sm" className="min-w-[90px]">
								<SelectValue placeholder="Format" />
							</SelectTrigger>
							<SelectContent>
								{config.availableFormats.map((format) => (
									<SelectItem key={format} value={format}>
										{format.toUpperCase()}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{config.supportsSpeed && (
						<Select
							value={String(speed)}
							onValueChange={(val) => setSpeed(Number(val))}
						>
							<SelectTrigger size="sm" className="min-w-[90px]">
								<SelectValue placeholder="Speed" />
							</SelectTrigger>
							<SelectContent>
								{config.availableSpeeds.map((s) => (
									<SelectItem key={s} value={String(s)}>
										{s}x
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<div className="flex-1" />
					<Button
						onClick={onGenerate}
						disabled={isGenerating || !canGenerate}
						className="min-w-[120px]"
					>
						{isGenerating ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin mr-2" />
								Generating...
							</>
						) : (
							<>
								<AudioLines className="h-4 w-4 mr-2" />
								Generate
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
