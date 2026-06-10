"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSkill } from "@/hooks/useSkills";

import type { Skill } from "@/hooks/useSkills";

interface GenerateSkillDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (skill: Skill) => void;
}

export function GenerateSkillDialog({
	open,
	onOpenChange,
	onSuccess,
}: GenerateSkillDialogProps) {
	const [prompt, setPrompt] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);

	const createSkill = useCreateSkill();

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setPrompt("");
		}
		onOpenChange(nextOpen);
	};

	const handleGenerate = async () => {
		if (!prompt.trim() || isGenerating) {
			return;
		}

		setIsGenerating(true);
		try {
			const response = await fetch("/api/generate-skill", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ prompt: prompt.trim() }),
			});

			if (!response.ok) {
				const data = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(data?.error ?? "Failed to generate skill");
			}

			const data = (await response.json()) as {
				skill: Pick<Skill, "name" | "description" | "instructions">;
			};

			const result = await createSkill.mutateAsync({
				body: {
					name: data.skill.name,
					description: data.skill.description,
					instructions: data.skill.instructions,
					enabled: true,
				},
			});

			if (result?.skill) {
				toast.success(`Skill "${data.skill.name}" created`);
				onSuccess?.(result.skill as Skill);
				handleOpenChange(false);
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to generate skill",
			);
		} finally {
			setIsGenerating(false);
		}
	};

	const isBusy = isGenerating || createSkill.isPending;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Sparkles className="h-4 w-4" />
						Generate skill with AI
					</DialogTitle>
					<DialogDescription>
						Describe what you want the skill to do and LLM Gateway will write
						and save it for you. You can edit it afterwards.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-2">
					<Label htmlFor="generate-skill-prompt">What should it do?</Label>
					<Textarea
						id="generate-skill-prompt"
						placeholder="A skill that reviews my pull requests for security issues and suggests fixes in a friendly tone..."
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								void handleGenerate();
							}
						}}
						rows={4}
						className="max-h-[30vh] resize-none overflow-y-auto"
						disabled={isBusy}
					/>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => handleOpenChange(false)}
						disabled={isBusy}
					>
						Cancel
					</Button>
					<Button onClick={handleGenerate} disabled={!prompt.trim() || isBusy}>
						{isBusy ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Generating...
							</>
						) : (
							<>
								<Sparkles className="mr-2 h-4 w-4" />
								Generate & save
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
