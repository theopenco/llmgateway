"use client";

import { CodeIcon, EyeIcon, ScrollTextIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { CreateSkillDialog } from "@/components/playground/create-skill-dialog";
import { GenerateSkillDialog } from "@/components/playground/generate-skill-dialog";
import { SkillsHeader } from "@/components/playground/skills-header";
import { SkillsSidebar } from "@/components/playground/skills-sidebar";
import { UploadSkillDialog } from "@/components/playground/upload-skill-dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	SKILL_DESCRIPTION_MAX,
	SKILL_NAME_MAX,
	useDeleteSkill,
	useSkills,
	useUpdateSkill,
} from "@/hooks/useSkills";
import { cn } from "@/lib/utils";

import type { Skill } from "@/hooks/useSkills";
import type { Organization } from "@/lib/types";

interface SkillsPageClientProps {
	selectedOrganization: Organization | null;
	initialSkillId: string | null;
}

export default function SkillsPageClient({
	selectedOrganization,
	initialSkillId,
}: SkillsPageClientProps) {
	const router = useRouter();
	const { data, isLoading } = useSkills();
	const skills = (data?.skills as Skill[] | undefined) ?? [];

	const [selectedSkillId, setSelectedSkillId] = useState<string | null>(
		initialSkillId,
	);

	useEffect(() => {
		setSelectedSkillId(initialSkillId);
	}, [initialSkillId]);

	const [createOpen, setCreateOpen] = useState(false);
	const [generateOpen, setGenerateOpen] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [viewMode, setViewMode] = useState<"rendered" | "raw">("rendered");
	const [skillToDelete, setSkillToDelete] = useState<Skill | null>(null);

	const deleteSkill = useDeleteSkill();

	const selectedSkill = skills.find((s) => s.id === selectedSkillId) ?? null;

	const handleSelectSkill = useCallback(
		(skillId: string) => {
			setSelectedSkillId(skillId);
			setViewMode("rendered");
			router.replace(`/skills?id=${skillId}`);
		},
		[router],
	);

	const handleDeleteConfirm = () => {
		if (!skillToDelete) {
			return;
		}
		deleteSkill.mutate(
			{ params: { path: { id: skillToDelete.id } } },
			{
				onSuccess: () => {
					if (selectedSkillId === skillToDelete.id) {
						setSelectedSkillId(null);
						router.replace("/skills");
					}
					setSkillToDelete(null);
				},
			},
		);
	};

	const handleCreateSuccess = (skill: Skill) => {
		setSelectedSkillId(skill.id);
		router.replace(`/skills?id=${skill.id}`);
	};

	return (
		<SidebarProvider>
			<SkillsSidebar
				skills={skills}
				selectedSkillId={selectedSkillId}
				onSelectSkill={handleSelectSkill}
				isLoading={isLoading}
				onCreateOpen={() => setCreateOpen(true)}
				onGenerateOpen={() => setGenerateOpen(true)}
				onUploadOpen={() => setUploadOpen(true)}
				selectedOrganization={selectedOrganization}
			/>
			<div className="flex h-svh bg-background w-full overflow-hidden flex-col">
				<SkillsHeader />
				<main className="flex flex-1 min-h-0 overflow-hidden">
					<SkillsPanel
						selectedSkill={selectedSkill}
						viewMode={viewMode}
						onViewModeChange={setViewMode}
						onDelete={setSkillToDelete}
					/>
				</main>
			</div>

			<CreateSkillDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSuccess={handleCreateSuccess}
			/>

			<GenerateSkillDialog
				open={generateOpen}
				onOpenChange={setGenerateOpen}
				onSuccess={handleCreateSuccess}
			/>

			<UploadSkillDialog
				open={uploadOpen}
				onOpenChange={setUploadOpen}
				onSuccess={handleCreateSuccess}
			/>

			<AlertDialog
				open={!!skillToDelete}
				onOpenChange={(open: boolean) => {
					if (!open) {
						setSkillToDelete(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete skill</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete &quot;{skillToDelete?.name}&quot;?
							This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={handleDeleteConfirm}
							disabled={deleteSkill.isPending}
						>
							{deleteSkill.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SidebarProvider>
	);
}

interface SkillsPanelProps {
	selectedSkill: Skill | null;
	viewMode: "rendered" | "raw";
	onViewModeChange: (mode: "rendered" | "raw") => void;
	onDelete: (skill: Skill) => void;
}

function SkillsPanel({
	selectedSkill,
	viewMode,
	onViewModeChange,
	onDelete,
}: SkillsPanelProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editInstructions, setEditInstructions] = useState("");

	const updateSkill = useUpdateSkill();

	useEffect(() => {
		setIsEditing(false);
	}, [selectedSkill?.id]);

	const startEdit = () => {
		if (!selectedSkill) {
			return;
		}
		setEditName(selectedSkill.name);
		setEditDescription(selectedSkill.description ?? "");
		setEditInstructions(selectedSkill.instructions);
		setIsEditing(true);
	};

	const cancelEdit = () => {
		setIsEditing(false);
	};

	const handleSave = async () => {
		if (!selectedSkill || !editName.trim() || !editInstructions.trim()) {
			return;
		}
		try {
			await updateSkill.mutateAsync({
				params: { path: { id: selectedSkill.id } },
				body: {
					name: editName.trim(),
					description: editDescription.trim(),
					instructions: editInstructions.trim(),
				},
			});
			setIsEditing(false);
		} catch {
			// error toast handled by useUpdateSkill
		}
	};

	const editNameTooLong = editName.length > SKILL_NAME_MAX;
	const editDescriptionTooLong = editDescription.length > SKILL_DESCRIPTION_MAX;
	const isSaveDisabled =
		!editName.trim() ||
		!editInstructions.trim() ||
		editNameTooLong ||
		editDescriptionTooLong ||
		updateSkill.isPending;

	return (
		<div className="flex flex-1 min-h-0 flex-col overflow-hidden">
			{!selectedSkill ? (
				<div className="flex h-full items-center justify-center px-6 text-center">
					<div>
						<ScrollTextIcon className="mx-auto mb-4 h-10 w-10 text-muted-foreground/40" />
						<p className="text-muted-foreground text-sm">
							Select a skill to view details
						</p>
					</div>
				</div>
			) : isEditing ? (
				<>
					{/* Inline edit form */}
					<div className="flex items-center justify-between border-b px-6 py-4">
						<h2 className="text-lg font-semibold">Edit skill</h2>
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" onClick={cancelEdit}>
								Cancel
							</Button>
							<Button size="sm" onClick={handleSave} disabled={isSaveDisabled}>
								{updateSkill.isPending ? "Saving..." : "Save"}
							</Button>
						</div>
					</div>
					<div className="flex-1 overflow-y-auto p-6 space-y-4">
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label htmlFor="inline-edit-name">Name</Label>
								<span
									className={cn(
										"text-xs tabular-nums",
										editNameTooLong
											? "text-destructive"
											: "text-muted-foreground",
									)}
								>
									{editName.length}/{SKILL_NAME_MAX}
								</span>
							</div>
							<Input
								id="inline-edit-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								placeholder="brand-guidelines"
								aria-invalid={editNameTooLong || undefined}
							/>
						</div>
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<Label htmlFor="inline-edit-description">Description</Label>
								<span
									className={cn(
										"text-xs tabular-nums",
										editDescriptionTooLong
											? "text-destructive"
											: "text-muted-foreground",
									)}
								>
									{editDescription.length}/{SKILL_DESCRIPTION_MAX}
								</span>
							</div>
							<Textarea
								id="inline-edit-description"
								value={editDescription}
								onChange={(e) => setEditDescription(e.target.value)}
								placeholder="Describe when to use this skill..."
								rows={2}
								aria-invalid={editDescriptionTooLong || undefined}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="inline-edit-instructions">Instructions</Label>
							<Textarea
								id="inline-edit-instructions"
								value={editInstructions}
								onChange={(e) => setEditInstructions(e.target.value)}
								placeholder="Enter your skill instructions in markdown..."
								rows={14}
								className="font-mono text-sm"
							/>
						</div>
					</div>
				</>
			) : (
				<>
					{/* Detail header */}
					<div className="flex items-center justify-between px-6 py-4">
						<div className="min-w-0 flex-1">
							<h2 className="truncate text-lg font-semibold">
								{selectedSkill.name}
							</h2>
							{selectedSkill.description && (
								<p className="mt-0.5 text-sm text-muted-foreground">
									{selectedSkill.description}
								</p>
							)}
						</div>
						<div className="ml-4 flex shrink-0 items-center gap-2">
							<Button variant="ghost" size="sm" onClick={startEdit}>
								Edit
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="text-destructive h-8 w-8"
								onClick={() => onDelete(selectedSkill)}
								aria-label="Delete skill"
							>
								<TrashIcon className="h-4 w-4" />
							</Button>
						</div>
					</div>
					{/* Separator with view toggle pinned to the right */}
					<div className="relative flex items-center px-6">
						<Separator />
						<div className="absolute right-6 bg-background pl-2">
							<Tabs
								value={viewMode}
								onValueChange={(v) => onViewModeChange(v as "rendered" | "raw")}
							>
								<TabsList className="h-7">
									<TabsTrigger
										value="rendered"
										className="h-6 w-6 p-0"
										aria-label="Rendered view"
									>
										<EyeIcon className="h-3.5 w-3.5" />
									</TabsTrigger>
									<TabsTrigger
										value="raw"
										className="h-6 w-6 p-0"
										aria-label="Raw view"
									>
										<CodeIcon className="h-3.5 w-3.5" />
									</TabsTrigger>
								</TabsList>
							</Tabs>
						</div>
					</div>

					{/* Instructions content */}
					<div className="flex-1 overflow-y-auto">
						{viewMode === "rendered" ? (
							<div className="prose prose-sm dark:prose-invert max-w-none p-6">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{selectedSkill.instructions}
								</ReactMarkdown>
							</div>
						) : (
							<pre className="h-full overflow-auto whitespace-pre-wrap break-words p-6 font-mono text-sm leading-relaxed">
								{selectedSkill.instructions}
							</pre>
						)}
					</div>
				</>
			)}
		</div>
	);
}
