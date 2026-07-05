"use client";

import {
	FileTextIcon,
	FolderIcon,
	Loader2Icon,
	MessageSquarePlusIcon,
	MessageSquareIcon,
	TrashIcon,
	UploadIcon,
	AlertCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CreateChatProjectDialog } from "@/components/playground/create-chat-project-dialog";
import { ProjectsSidebar } from "@/components/playground/projects-sidebar";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import {
	PROJECT_DESCRIPTION_MAX,
	PROJECT_FILE_MAX_BYTES,
	PROJECT_NAME_MAX,
	useChatProject,
	useChatProjects,
	useDeleteChatProject,
	useDeleteProjectFile,
	useProjectChats,
	useUpdateChatProject,
	useUploadProjectFile,
} from "@/hooks/useChatProjects";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";

import type { ChatProject, ChatProjectFile } from "@/hooks/useChatProjects";
import type { Organization } from "@/lib/types";

// Text-based formats we can read client-side; PDFs and other binary formats
// are not supported as knowledge files yet.
const ACCEPTED_FILE_EXTENSIONS =
	".txt,.md,.markdown,.mdx,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.log,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.css";

function formatBytes(bytes: number) {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ProjectsPageClientProps {
	selectedOrganization: Organization | null;
	initialProjectId: string | null;
}

export default function ProjectsPageClient({
	selectedOrganization,
	initialProjectId,
}: ProjectsPageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	// Preserve the selected organization across projects navigation, matching
	// the chat sidebar's withOrg behavior.
	const orgIdParam = searchParams.get("orgId");
	const withOrg = useCallback(
		(path: string) =>
			orgIdParam
				? `${path}${path.includes("?") ? "&" : "?"}orgId=${orgIdParam}`
				: path,
		[orgIdParam],
	);
	// Scope projects to the chat org context, matching how chats are scoped.
	const { organization: chatOrg } = useOrganization();
	const resolvedOrgId = selectedOrganization?.id ?? chatOrg?.id;
	const { data, isLoading } = useChatProjects(resolvedOrgId);
	const projects = (data?.projects as ChatProject[] | undefined) ?? [];

	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
		initialProjectId,
	);
	const [createOpen, setCreateOpen] = useState(false);
	const [projectToDelete, setProjectToDelete] = useState<ChatProject | null>(
		null,
	);

	useEffect(() => {
		setSelectedProjectId(initialProjectId);
	}, [initialProjectId]);

	const deleteProject = useDeleteChatProject();

	const selectedProject =
		projects.find((p) => p.id === selectedProjectId) ?? null;

	const handleSelectProject = useCallback(
		(projectId: string) => {
			setSelectedProjectId(projectId);
			router.replace(withOrg(`/projects?id=${projectId}`));
		},
		[router, withOrg],
	);

	const handleCreateSuccess = (project: ChatProject) => {
		setSelectedProjectId(project.id);
		router.replace(withOrg(`/projects?id=${project.id}`));
	};

	const handleDeleteConfirm = () => {
		if (!projectToDelete) {
			return;
		}
		deleteProject.mutate(
			{ params: { path: { id: projectToDelete.id } } },
			{
				onSuccess: () => {
					if (selectedProjectId === projectToDelete.id) {
						setSelectedProjectId(null);
						router.replace(withOrg("/projects"));
					}
					setProjectToDelete(null);
				},
			},
		);
	};

	return (
		<SidebarProvider>
			<ProjectsSidebar
				projects={projects}
				selectedProjectId={selectedProjectId}
				onSelectProject={handleSelectProject}
				isLoading={isLoading}
				onCreateOpen={() => setCreateOpen(true)}
				selectedOrganization={selectedOrganization}
			/>
			<div className="flex h-svh bg-background w-full overflow-hidden flex-col">
				<header className="bg-background flex items-center border-b p-4">
					<div className="flex min-w-0 flex-1 items-center gap-3">
						<SidebarTrigger />
						<span className="text-lg font-medium">Projects</span>
					</div>
				</header>
				<main className="flex flex-1 min-h-0 overflow-hidden">
					{selectedProject ? (
						<ProjectPanel
							project={selectedProject}
							onDelete={setProjectToDelete}
							withOrg={withOrg}
						/>
					) : (
						<div className="flex h-full w-full items-center justify-center px-6 text-center">
							<div>
								<FolderIcon className="mx-auto mb-4 h-10 w-10 text-muted-foreground/40" />
								<p className="text-muted-foreground text-sm mb-4">
									{projects.length === 0
										? "Create a project to group chats and give the AI a knowledge base"
										: "Select a project to view its knowledge base and chats"}
								</p>
								{projects.length === 0 && (
									<Button onClick={() => setCreateOpen(true)}>
										Create your first project
									</Button>
								)}
							</div>
						</div>
					)}
				</main>
			</div>

			<CreateChatProjectDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSuccess={handleCreateSuccess}
				organizationId={resolvedOrgId}
			/>

			<AlertDialog
				open={!!projectToDelete}
				onOpenChange={(open: boolean) => {
					if (!open) {
						setProjectToDelete(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete project</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete &quot;{projectToDelete?.name}
							&quot;? Its knowledge base files will be removed. Chats in the
							project are kept but lose the project context.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={handleDeleteConfirm}
							disabled={deleteProject.isPending}
						>
							{deleteProject.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SidebarProvider>
	);
}

interface ProjectPanelProps {
	project: ChatProject;
	onDelete: (project: ChatProject) => void;
	withOrg: (path: string) => string;
}

function ProjectPanel({ project, onDelete, withOrg }: ProjectPanelProps) {
	const { data: detailData } = useChatProject(project.id);
	const files = (detailData?.files as ChatProjectFile[] | undefined) ?? [];
	const { data: chatsData } = useProjectChats(project.id);
	const chats = chatsData?.chats ?? [];

	const updateProject = useUpdateChatProject();
	const uploadFile = useUploadProjectFile();
	const deleteFile = useDeleteProjectFile();

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [uploadingNames, setUploadingNames] = useState<string[]>([]);

	const [isEditing, setIsEditing] = useState(false);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editInstructions, setEditInstructions] = useState("");

	useEffect(() => {
		setIsEditing(false);
	}, [project.id]);

	const startEdit = () => {
		setEditName(project.name);
		setEditDescription(project.description);
		setEditInstructions(project.instructions);
		setIsEditing(true);
	};

	const handleSave = async () => {
		if (!editName.trim()) {
			return;
		}
		try {
			await updateProject.mutateAsync({
				params: { path: { id: project.id } },
				body: {
					name: editName.trim(),
					description: editDescription.trim(),
					instructions: editInstructions.trim(),
				},
			});
			setIsEditing(false);
		} catch {
			// error toast handled by useUpdateChatProject
		}
	};

	const handleFilesSelected = async (fileList: FileList | null) => {
		if (!fileList?.length) {
			return;
		}
		for (const file of Array.from(fileList)) {
			if (file.size > PROJECT_FILE_MAX_BYTES) {
				toast.error(
					`${file.name} is larger than ${formatBytes(PROJECT_FILE_MAX_BYTES)}`,
				);
				continue;
			}
			let content: string;
			try {
				content = await file.text();
			} catch {
				toast.error(`Could not read ${file.name} as text`);
				continue;
			}
			if (!content.trim()) {
				toast.error(`${file.name} has no text content`);
				continue;
			}
			setUploadingNames((prev) => [...prev, file.name]);
			try {
				await uploadFile.mutateAsync({
					params: { path: { id: project.id } },
					body: {
						name: file.name,
						mimeType: file.type || "text/plain",
						content,
					},
				});
				toast(`${file.name} added to the knowledge base`);
			} catch {
				// error toast handled by useUploadProjectFile
			} finally {
				setUploadingNames((prev) => prev.filter((n) => n !== file.name));
			}
		}
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const editNameTooLong = editName.length > PROJECT_NAME_MAX;
	const editDescriptionTooLong =
		editDescription.length > PROJECT_DESCRIPTION_MAX;
	const isSaveDisabled =
		!editName.trim() ||
		editNameTooLong ||
		editDescriptionTooLong ||
		updateProject.isPending;

	if (isEditing) {
		return (
			<div className="flex flex-1 min-h-0 flex-col overflow-hidden">
				<div className="flex items-center justify-between border-b px-6 py-4">
					<h2 className="text-lg font-semibold">Edit project</h2>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setIsEditing(false)}
						>
							Cancel
						</Button>
						<Button size="sm" onClick={handleSave} disabled={isSaveDisabled}>
							{updateProject.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
				</div>
				<div className="flex-1 overflow-y-auto p-6 space-y-4">
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="edit-project-name">Name</Label>
							<span
								className={cn(
									"text-xs tabular-nums",
									editNameTooLong
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								{editName.length}/{PROJECT_NAME_MAX}
							</span>
						</div>
						<Input
							id="edit-project-name"
							value={editName}
							onChange={(e) => setEditName(e.target.value)}
							aria-invalid={editNameTooLong || undefined}
						/>
					</div>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="edit-project-description">Description</Label>
							<span
								className={cn(
									"text-xs tabular-nums",
									editDescriptionTooLong
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								{editDescription.length}/{PROJECT_DESCRIPTION_MAX}
							</span>
						</div>
						<Textarea
							id="edit-project-description"
							value={editDescription}
							onChange={(e) => setEditDescription(e.target.value)}
							rows={2}
							aria-invalid={editDescriptionTooLong || undefined}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="edit-project-instructions">Instructions</Label>
						<Textarea
							id="edit-project-instructions"
							value={editInstructions}
							onChange={(e) => setEditInstructions(e.target.value)}
							placeholder="Custom instructions for every chat in this project..."
							rows={8}
						/>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 min-h-0 flex-col overflow-hidden">
			<div className="flex items-center justify-between px-6 py-4">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-lg font-semibold">{project.name}</h2>
					{project.description && (
						<p className="mt-0.5 text-sm text-muted-foreground">
							{project.description}
						</p>
					)}
				</div>
				<div className="ml-4 flex shrink-0 items-center gap-2">
					<Button size="sm" asChild>
						<Link href={withOrg(`/?project=${project.id}`)}>
							<MessageSquarePlusIcon className="mr-1.5 h-4 w-4" />
							New chat
						</Link>
					</Button>
					<Button variant="ghost" size="sm" onClick={startEdit}>
						Edit
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="text-destructive h-8 w-8"
						onClick={() => onDelete(project)}
						aria-label="Delete project"
					>
						<TrashIcon className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<div className="px-6">
				<Separator />
			</div>

			<div className="flex-1 overflow-y-auto p-6 space-y-8">
				{/* Knowledge base */}
				<section>
					<div className="mb-3 flex items-center justify-between">
						<div>
							<h3 className="text-sm font-semibold">Knowledge base</h3>
							<p className="text-xs text-muted-foreground">
								Chats in this project answer using these files
							</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => fileInputRef.current?.click()}
							disabled={uploadingNames.length > 0}
						>
							{uploadingNames.length > 0 ? (
								<Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
							) : (
								<UploadIcon className="mr-1.5 h-4 w-4" />
							)}
							{uploadingNames.length > 0 ? "Indexing..." : "Add files"}
						</Button>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							accept={ACCEPTED_FILE_EXTENSIONS}
							className="hidden"
							onChange={(e) => void handleFilesSelected(e.target.files)}
						/>
					</div>

					{files.length === 0 && uploadingNames.length === 0 ? (
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="w-full rounded-lg border border-dashed p-8 text-center hover:bg-accent/50 transition-colors"
						>
							<FileTextIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
							<p className="text-sm text-muted-foreground">
								Upload text or markdown files to build the knowledge base
							</p>
						</button>
					) : (
						<ul className="space-y-2">
							{uploadingNames.map((name) => (
								<li
									key={`uploading-${name}`}
									className="flex items-center gap-3 rounded-lg border p-3"
								>
									<Loader2Icon className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{name}</div>
										<div className="text-xs text-muted-foreground">
											Chunking and embedding...
										</div>
									</div>
								</li>
							))}
							{files.map((file) => (
								<li
									key={file.id}
									className="flex items-center gap-3 rounded-lg border p-3"
								>
									{file.status === "error" ? (
										<AlertCircleIcon className="h-4 w-4 shrink-0 text-destructive" />
									) : (
										<FileTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
									)}
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">
											{file.name}
										</div>
										<div className="text-xs text-muted-foreground">
											{file.status === "error"
												? (file.error ?? "Indexing failed")
												: `${formatBytes(file.size)} · ${file.chunkCount} ${
														file.chunkCount === 1 ? "chunk" : "chunks"
													}`}
										</div>
									</div>
									{file.status === "ready" && (
										<Badge variant="secondary" className="shrink-0">
											Indexed
										</Badge>
									)}
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
										onClick={() =>
											deleteFile.mutate({
												params: {
													path: { id: project.id, fileId: file.id },
												},
											})
										}
										aria-label={`Delete ${file.name}`}
									>
										<TrashIcon className="h-4 w-4" />
									</Button>
								</li>
							))}
						</ul>
					)}
				</section>

				{/* Instructions */}
				{project.instructions && (
					<section>
						<h3 className="mb-3 text-sm font-semibold">Instructions</h3>
						<p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
							{project.instructions}
						</p>
					</section>
				)}

				{/* Chats */}
				<section>
					<h3 className="mb-3 text-sm font-semibold">Chats in this project</h3>
					{chats.length === 0 ? (
						<div className="rounded-lg border border-dashed p-6 text-center">
							<p className="text-sm text-muted-foreground mb-3">
								No chats yet. Start one to ask questions about your files.
							</p>
							<Button size="sm" asChild>
								<Link href={withOrg(`/?project=${project.id}`)}>
									<MessageSquarePlusIcon className="mr-1.5 h-4 w-4" />
									Start a chat
								</Link>
							</Button>
						</div>
					) : (
						<ul className="space-y-1">
							{chats.map((chat) => (
								<li key={chat.id}>
									<Link
										href={withOrg(`/?id=${chat.id}`)}
										className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent transition-colors"
									>
										<MessageSquareIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate text-sm">
											{chat.title}
										</span>
										<span className="shrink-0 text-xs text-muted-foreground">
											{new Date(chat.updatedAt).toLocaleDateString()}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</div>
	);
}
