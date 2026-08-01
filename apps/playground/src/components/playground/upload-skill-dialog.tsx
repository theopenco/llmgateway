"use client";

import { UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

import { CreateSkillDialog } from "@/components/playground/create-skill-dialog";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import type { Skill } from "@/hooks/useSkills";

interface ParsedSkill {
	name: string;
	description: string;
	instructions: string;
}

function parseSkillMarkdown(content: string): ParsedSkill | null {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
	);
	if (!frontmatterMatch) {
		return null;
	}

	const frontmatter = frontmatterMatch[1];
	const body = frontmatterMatch[2].trim();

	const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
	const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);

	if (!nameMatch) {
		return null;
	}

	return {
		name: nameMatch[1].trim(),
		description: descriptionMatch?.[1].trim() ?? "",
		instructions: body,
	};
}

interface UploadSkillDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (skill: Skill) => void;
}

export function UploadSkillDialog({
	open,
	onOpenChange,
	onSuccess,
}: UploadSkillDialogProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [parsed, setParsed] = useState<ParsedSkill | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFile = (file: File) => {
		setError(null);

		if (file.size > 50 * 1024 * 1024) {
			setError("File size must not exceed 50 MB.");
			return;
		}

		if (!file.name.endsWith(".md")) {
			setError(
				"Only .md files are supported for upload. .zip/.skill support coming soon.",
			);
			return;
		}

		const reader = new FileReader();
		reader.onload = (e) => {
			const content = e.target?.result as string;
			const result = parseSkillMarkdown(content);
			if (!result) {
				setError(
					"Could not parse skill. The .md file must contain YAML frontmatter with a `name` field.",
				);
				return;
			}
			setParsed(result);
			onOpenChange(false);
			setCreateOpen(true);
		};
		reader.readAsText(file);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		const file = e.dataTransfer.files[0];
		if (file) {
			handleFile(file);
		}
	};

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			handleFile(file);
		}
	};

	const handleCreateSuccess = (skill: Skill) => {
		setParsed(null);
		onSuccess?.(skill);
	};

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-[420px]">
					<DialogHeader>
						<DialogTitle>Upload skill</DialogTitle>
					</DialogHeader>

					<div
						className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
							isDragging
								? "border-primary bg-primary/5"
								: "border-border hover:border-primary/50 hover:bg-muted/30"
						}`}
						onDragOver={(e) => {
							e.preventDefault();
							setIsDragging(true);
						}}
						onDragLeave={() => setIsDragging(false)}
						onDrop={handleDrop}
						onClick={() => inputRef.current?.click()}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								inputRef.current?.click();
							}
						}}
						aria-label="Upload skill file"
					>
						<UploadIcon className="text-muted-foreground mb-2 h-8 w-8" />
						<p className="text-muted-foreground text-sm">
							Drag and drop or click to upload
						</p>
						<input
							ref={inputRef}
							type="file"
							accept=".md"
							className="hidden"
							onChange={handleInputChange}
						/>
					</div>

					{error && <p className="text-destructive mt-2 text-sm">{error}</p>}

					<div className="mt-4">
						<p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
							File requirements
						</p>
						<ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
							<li>
								.md file must contain a <code>name</code> field in YAML
								frontmatter
							</li>
							<li>.zip or .skill file must include a SKILL.md file</li>
							<li>File size must not exceed 50 MB</li>
						</ul>
					</div>
				</DialogContent>
			</Dialog>

			{parsed && (
				<CreateSkillDialog
					open={createOpen}
					onOpenChange={(o) => {
						setCreateOpen(o);
						if (!o) {
							setParsed(null);
						}
					}}
					initialValues={parsed}
					onSuccess={handleCreateSuccess}
				/>
			)}
		</>
	);
}
