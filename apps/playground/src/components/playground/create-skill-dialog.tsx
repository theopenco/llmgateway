"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	SKILL_DESCRIPTION_MAX,
	SKILL_NAME_MAX,
	useCreateSkill,
} from "@/hooks/useSkills";
import { cn } from "@/lib/utils";

import type { Skill } from "@/hooks/useSkills";

interface CreateSkillDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (skill: Skill) => void;
	initialValues?: Partial<Pick<Skill, "name" | "description" | "instructions">>;
}

export function CreateSkillDialog({
	open,
	onOpenChange,
	onSuccess,
	initialValues,
}: CreateSkillDialogProps) {
	const [name, setName] = useState(initialValues?.name ?? "");
	const [description, setDescription] = useState(
		initialValues?.description ?? "",
	);
	const [instructions, setInstructions] = useState(
		initialValues?.instructions ?? "",
	);

	const createSkill = useCreateSkill();

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setName(initialValues?.name ?? "");
			setDescription(initialValues?.description ?? "");
			setInstructions(initialValues?.instructions ?? "");
		}
		onOpenChange(nextOpen);
	};

	const handleSubmit = async () => {
		if (!name.trim() || !instructions.trim()) {
			return;
		}

		try {
			const result = await createSkill.mutateAsync({
				body: {
					name: name.trim(),
					description: description.trim(),
					instructions: instructions.trim(),
					enabled: true,
				},
			});

			if (result?.skill) {
				onSuccess?.(result.skill as Skill);
				handleOpenChange(false);
			}
		} catch {
			// error toast handled by useCreateSkill
		}
	};

	const isSubmitting = createSkill.isPending;
	const nameTooLong = name.length > SKILL_NAME_MAX;
	const descriptionTooLong = description.length > SKILL_DESCRIPTION_MAX;
	const isDisabled =
		!name.trim() ||
		!instructions.trim() ||
		nameTooLong ||
		descriptionTooLong ||
		isSubmitting;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[560px] flex flex-col max-h-[90vh]">
				<DialogHeader>
					<DialogTitle>Write skill instructions</DialogTitle>
					<DialogDescription>
						Create a reusable instruction set to guide the AI in a specific
						context.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0">
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="skill-name">Name</Label>
							<span
								className={cn(
									"text-xs tabular-nums",
									nameTooLong ? "text-destructive" : "text-muted-foreground",
								)}
							>
								{name.length}/{SKILL_NAME_MAX}
							</span>
						</div>
						<Input
							id="skill-name"
							placeholder="brand-guidelines"
							value={name}
							onChange={(e) => setName(e.target.value)}
							aria-invalid={nameTooLong || undefined}
						/>
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="skill-description">Description</Label>
							<span
								className={cn(
									"text-xs tabular-nums",
									descriptionTooLong
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								{description.length}/{SKILL_DESCRIPTION_MAX}
							</span>
						</div>
						<Textarea
							id="skill-description"
							placeholder="Apply Acme Corp brand guidelines to presentations and documents..."
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							className="max-h-[10vh] overflow-y-auto resize-none"
							aria-invalid={descriptionTooLong || undefined}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="skill-instructions">Instructions</Label>
						<Textarea
							id="skill-instructions"
							placeholder="Enter your skill instructions in markdown..."
							value={instructions}
							onChange={(e) => setInstructions(e.target.value)}
							rows={6}
							className="font-mono text-sm max-h-[28vh] overflow-y-auto resize-none"
						/>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => handleOpenChange(false)}
						disabled={isSubmitting}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={isDisabled}>
						{isSubmitting ? "Creating..." : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
