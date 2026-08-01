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
	PROJECT_DESCRIPTION_MAX,
	PROJECT_NAME_MAX,
	useCreateChatProject,
} from "@/hooks/useChatProjects";
import { cn } from "@/lib/utils";

import type { ChatProject } from "@/hooks/useChatProjects";

interface CreateChatProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (project: ChatProject) => void;
	organizationId?: string;
}

export function CreateChatProjectDialog({
	open,
	onOpenChange,
	onSuccess,
	organizationId,
}: CreateChatProjectDialogProps) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [instructions, setInstructions] = useState("");

	const createProject = useCreateChatProject();

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setName("");
			setDescription("");
			setInstructions("");
		}
		onOpenChange(nextOpen);
	};

	const handleSubmit = async () => {
		if (!name.trim()) {
			return;
		}

		try {
			const result = await createProject.mutateAsync({
				body: {
					name: name.trim(),
					description: description.trim(),
					instructions: instructions.trim(),
					...(organizationId ? { organizationId } : {}),
				},
			});

			if (result?.project) {
				onSuccess?.(result.project as ChatProject);
				handleOpenChange(false);
			}
		} catch {
			// error toast handled by useCreateChatProject
		}
	};

	const isSubmitting = createProject.isPending;
	const nameTooLong = name.length > PROJECT_NAME_MAX;
	const descriptionTooLong = description.length > PROJECT_DESCRIPTION_MAX;
	const isDisabled =
		!name.trim() || nameTooLong || descriptionTooLong || isSubmitting;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[560px] flex flex-col max-h-[90vh]">
				<DialogHeader>
					<DialogTitle>Create a project</DialogTitle>
					<DialogDescription>
						Group chats around a topic and upload files as a knowledge base the
						AI answers from.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0">
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="project-name">Name</Label>
							<span
								className={cn(
									"text-xs tabular-nums",
									nameTooLong ? "text-destructive" : "text-muted-foreground",
								)}
							>
								{name.length}/{PROJECT_NAME_MAX}
							</span>
						</div>
						<Input
							id="project-name"
							placeholder="Product Docs"
							value={name}
							onChange={(e) => setName(e.target.value)}
							aria-invalid={nameTooLong || undefined}
						/>
					</div>

					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="project-description">Description</Label>
							<span
								className={cn(
									"text-xs tabular-nums",
									descriptionTooLong
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								{description.length}/{PROJECT_DESCRIPTION_MAX}
							</span>
						</div>
						<Textarea
							id="project-description"
							placeholder="What is this project about?"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							className="max-h-[10vh] overflow-y-auto resize-none"
							aria-invalid={descriptionTooLong || undefined}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="project-instructions">
							Instructions{" "}
							<span className="text-muted-foreground font-normal">
								(optional)
							</span>
						</Label>
						<Textarea
							id="project-instructions"
							placeholder="Custom instructions for every chat in this project, e.g. 'Answer strictly from the knowledge base.'"
							value={instructions}
							onChange={(e) => setInstructions(e.target.value)}
							rows={4}
							className="max-h-[24vh] overflow-y-auto resize-none"
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
						{isSubmitting ? "Creating..." : "Create project"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
