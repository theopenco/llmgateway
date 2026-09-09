"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	FileCode2,
	FolderUp,
	Loader2,
	Plus,
	Trash2,
	Upload,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/lib/components/empty";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/lib/components/field";
import { Skeleton } from "@/lib/components/skeleton";
import { Switch } from "@/lib/components/switch";
import { Textarea } from "@/lib/components/textarea";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type Skill =
	paths["/orgs/{organizationId}/skills/{id}"]["get"]["responses"][200]["content"]["application/json"]["skill"];
type Bundle = Pick<Skill, "content" | "files">;

const template = `---
name: code-review
description: Review code changes against our team's standards.
---

# Code review

- Check correctness and error handling.
- Explain the impact of each finding.
- Suggest tests for important edge cases.
`;

function errorMessage(error: unknown) {
	return error &&
		typeof error === "object" &&
		"message" in error &&
		typeof error.message === "string"
		? error.message
		: "Unable to save this change. Check the skill format and try again.";
}

async function readBundle(upload: FileList): Promise<Bundle> {
	const files = Array.from(upload);
	if (
		files.length > 101 ||
		files.reduce((sum, file) => sum + file.size, 0) > 1024 * 1024
	) {
		throw new Error(
			"Upload up to 100 supporting files, with a total size of 1 MB or less.",
		);
	}
	const main = files.find(
		(file) =>
			file.name === "SKILL.md" &&
			(!file.webkitRelativePath ||
				file.webkitRelativePath.split("/").length === 2),
	);
	if (!main) {
		throw new Error(
			"Choose a SKILL.md file or a skill folder with SKILL.md at its root.",
		);
	}
	const prefix = main.webkitRelativePath
		? main.webkitRelativePath.slice(0, -"SKILL.md".length)
		: "";
	const supportingFiles: Bundle["files"] = [];
	for (const file of files) {
		if (file === main) {
			continue;
		}
		const path = file.webkitRelativePath.slice(prefix.length);
		if (!prefix || !file.webkitRelativePath.startsWith(prefix)) {
			throw new Error(
				"All supporting files must be inside the selected skill folder.",
			);
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		let content: string;
		let encoding: "utf-8" | "base64" = "utf-8";
		try {
			content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			if (content.includes("\0")) {
				throw new Error("Binary file");
			}
		} catch {
			content = btoa(
				Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
			);
			encoding = "base64";
		}
		supportingFiles.push({ path, content, encoding });
	}
	return { content: await main.text(), files: supportingFiles };
}

function SkillForm({
	organizationId,
	initial,
	skillId,
	readOnly,
	onSaved,
}: {
	organizationId: string;
	initial: Bundle;
	skillId?: string;
	readOnly: boolean;
	onSaved: () => void;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [content, setContent] = useState(initial.content);
	const [files, setFiles] = useState(initial.files);
	const [importing, setImporting] = useState(false);
	const folderInput = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const create = api.useMutation("post", "/orgs/{organizationId}/skills");
	const update = api.useMutation("put", "/orgs/{organizationId}/skills/{id}");
	const pending = create.isPending || update.isPending || importing;

	async function replaceBundle(upload: FileList | null) {
		if (!upload?.length) {
			return;
		}
		setError(null);
		setImporting(true);
		try {
			const bundle = await readBundle(upload);
			setContent(bundle.content);
			setFiles(bundle.files);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setImporting(false);
		}
	}

	async function save() {
		setError(null);
		try {
			if (skillId) {
				const updated = await update.mutateAsync({
					params: { path: { organizationId, id: skillId } },
					body: { content, files },
				});
				queryClient.setQueryData(
					api.queryOptions("get", "/orgs/{organizationId}/skills/{id}", {
						params: { path: { organizationId, id: skillId } },
					}).queryKey,
					updated,
				);
			} else {
				await create.mutateAsync({
					params: { path: { organizationId } },
					body: { content, files },
				});
			}
			onSaved();
			toast({ title: "Skill saved" });
		} catch (cause) {
			setError(errorMessage(cause));
		}
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
			className="flex min-h-0 flex-col gap-5"
		>
			{!readOnly && (
				<div>
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						onClick={() => folderInput.current?.click()}
					>
						<FolderUp data-icon="inline-start" />
						Replace from folder
					</Button>
					<input
						ref={folderInput}
						type="file"
						className="hidden"
						aria-label="Replace skill folder"
						{...{ webkitdirectory: "" }}
						onChange={(event) => {
							void replaceBundle(event.target.files);
							event.target.value = "";
						}}
					/>
				</div>
			)}
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="skill-content">SKILL.md</FieldLabel>
					<FieldDescription>
						Use a lowercase, hyphenated name and a description in the YAML
						header, followed by your instructions.
					</FieldDescription>
					<Textarea
						id="skill-content"
						className="min-h-72 max-h-[45vh] overflow-y-auto font-mono"
						value={content}
						onChange={(event) => setContent(event.target.value)}
						readOnly={readOnly}
						disabled={pending}
						required
						maxLength={200_000}
					/>
				</Field>
			</FieldGroup>
			{files.length > 0 && (
				<div
					className="flex max-h-36 flex-col gap-1 overflow-y-auto"
					aria-label="Supporting files"
				>
					<p className="text-sm font-medium">
						Supporting files ({files.length})
					</p>
					{files.map((file) => (
						<div
							key={file.path}
							className="flex items-center justify-between gap-2 text-sm"
						>
							<span className="truncate">{file.path}</span>
							{!readOnly && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={pending}
									aria-label={`Remove ${file.path}`}
									onClick={() =>
										setFiles(files.filter((item) => item.path !== file.path))
									}
								>
									<Trash2 />
								</Button>
							)}
						</div>
					))}
				</div>
			)}
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			{!readOnly && (
				<DialogFooter>
					<Button type="submit" disabled={pending}>
						{pending && (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						)}
						Save skill
					</Button>
				</DialogFooter>
			)}
		</form>
	);
}

function ExistingSkill({
	organizationId,
	id,
	readOnly,
	onSaved,
}: {
	organizationId: string;
	id: string;
	readOnly: boolean;
	onSaved: () => void;
}) {
	const api = useApi();
	const query = api.useQuery("get", "/orgs/{organizationId}/skills/{id}", {
		params: { path: { organizationId, id } },
	});
	if (query.isPending) {
		return <Skeleton className="h-72" />;
	}
	if (query.isError) {
		return (
			<Alert variant="destructive">
				<AlertDescription>
					Unable to load this skill.{" "}
					<Button variant="link" onClick={() => void query.refetch()}>
						Try again
					</Button>
				</AlertDescription>
			</Alert>
		);
	}
	return (
		<SkillForm
			key={query.data.skill.updatedAt}
			organizationId={organizationId}
			skillId={id}
			initial={query.data.skill}
			readOnly={readOnly}
			onSaved={onSaved}
		/>
	);
}

export function OrganizationSkills({
	organizationId,
}: {
	organizationId: string;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardNavigation();
	const enterprise = selectedOrganization?.enterpriseAccess === true;
	const manage =
		selectedOrganization?.role === "owner" ||
		selectedOrganization?.role === "admin";
	const queryOptions = { params: { path: { organizationId } } };
	const query = api.useQuery(
		"get",
		"/orgs/{organizationId}/skills",
		queryOptions,
		{ enabled: enterprise },
	);
	const toggle = api.useMutation("patch", "/orgs/{organizationId}/skills/{id}");
	const remove = api.useMutation(
		"delete",
		"/orgs/{organizationId}/skills/{id}",
	);
	const [editor, setEditor] = useState<{ id: string } | Bundle | null>(null);
	const [deleteSkill, setDeleteSkill] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const folderInput = useRef<HTMLInputElement>(null);
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: api.queryOptions(
				"get",
				"/orgs/{organizationId}/skills",
				queryOptions,
			).queryKey,
		});
	const saved = () => {
		setEditor(null);
		void refresh();
	};

	async function upload(files: FileList | null) {
		if (!files?.length) {
			return;
		}
		setError(null);
		setImporting(true);
		try {
			setEditor(await readBundle(files));
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setImporting(false);
		}
	}

	return (
		<div className="flex flex-col gap-6 p-4 pt-6 md:p-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold tracking-tight md:text-3xl">
						Skills
					</h1>
					<p className="text-muted-foreground">
						Share your organization&apos;s workflows and expertise with
						developers in the CLI.
					</p>
				</div>
				{enterprise && manage && (
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={importing}
							onClick={() => fileInput.current?.click()}
						>
							<Upload data-icon="inline-start" />
							Import SKILL.md
						</Button>
						<Button
							variant="outline"
							disabled={importing}
							onClick={() => folderInput.current?.click()}
						>
							<FolderUp data-icon="inline-start" />
							Import folder
						</Button>
						<Button onClick={() => setEditor({ content: template, files: [] })}>
							<Plus data-icon="inline-start" />
							New custom skill
						</Button>
						<input
							ref={fileInput}
							type="file"
							accept=".md"
							className="hidden"
							aria-label="Import SKILL.md"
							onChange={(event) => {
								void upload(event.target.files);
								event.target.value = "";
							}}
						/>
						<input
							ref={folderInput}
							type="file"
							className="hidden"
							aria-label="Import skill folder"
							{...{ webkitdirectory: "" }}
							onChange={(event) => {
								void upload(event.target.files);
								event.target.value = "";
							}}
						/>
					</div>
				)}
			</div>
			{!enterprise ? (
				<Card>
					<CardHeader>
						<CardTitle>Organization skills are an Enterprise feature</CardTitle>
						<CardDescription>
							Publish shared skills once so your developers can use the same
							instructions and supporting files in the CLI.
						</CardDescription>
					</CardHeader>
					<CardFooter>
						<Button asChild>
							<Link href="/enterprise">Explore Enterprise</Link>
						</Button>
					</CardFooter>
				</Card>
			) : (
				<>
					<Alert>
						<FileCode2 />
						<AlertTitle>Available across your organization</AlertTitle>
						<AlertDescription>
							Developers use a project API key from this organization to access
							enabled skills in the CLI. Owners and admins manage publishing.{" "}
							<Link
								href="https://docs.llmgateway.io/features/organization-skills"
								className="underline"
							>
								Read the guide
							</Link>
						</AlertDescription>
					</Alert>
					{error && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					{query.isPending ? (
						<Skeleton className="h-56" />
					) : query.isError ? (
						<Alert variant="destructive">
							<AlertDescription>
								Unable to load skills.{" "}
								<Button variant="link" onClick={() => void query.refetch()}>
									Try again
								</Button>
							</AlertDescription>
						</Alert>
					) : query.data?.skills.length ? (
						<div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
							{query.data.skills.map((skill) => (
								<Card key={skill.id}>
									<CardHeader>
										<div className="flex items-center justify-between gap-3">
											<CardTitle className="min-w-0 break-all">
												{skill.name}
											</CardTitle>
											<Badge
												className="shrink-0"
												variant={skill.enabled ? "default" : "secondary"}
											>
												{skill.enabled ? "Enabled" : "Disabled"}
											</Badge>
										</div>
										<CardDescription className="[overflow-wrap:anywhere]">
											{skill.description}
										</CardDescription>
									</CardHeader>
									<CardContent>
										<p className="text-sm text-muted-foreground">
											{skill.enabled
												? "Available to developers in the CLI"
												: "Hidden from CLI discovery and downloads"}
										</p>
									</CardContent>
									<CardFooter className="mt-auto flex flex-wrap justify-between gap-3">
										<Button
											variant="outline"
											onClick={() => setEditor({ id: skill.id })}
										>
											{manage ? "Edit skill" : "View skill"}
										</Button>
										{manage && (
											<div className="flex items-center gap-3">
												<Switch
													aria-label={`Enable ${skill.name}`}
													checked={skill.enabled}
													disabled={toggle.isPending}
													onCheckedChange={(enabled) => {
														setError(null);
														toggle.mutate(
															{
																params: {
																	path: { organizationId, id: skill.id },
																},
																body: { enabled },
															},
															{
																onSuccess: () => {
																	void refresh();
																},
																onError: (cause) =>
																	setError(errorMessage(cause)),
															},
														);
													}}
												/>
												<Button
													variant="ghost"
													size="icon"
													aria-label={`Delete ${skill.name}`}
													onClick={() => setDeleteSkill(skill)}
												>
													<Trash2 />
												</Button>
											</div>
										)}
									</CardFooter>
								</Card>
							))}
						</div>
					) : (
						<Empty className="border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileCode2 />
								</EmptyMedia>
								<EmptyTitle>No organization skills yet</EmptyTitle>
								<EmptyDescription>
									{manage
										? "Import an existing skill or create custom instructions for your team. Skill folders can include references, scripts, and assets."
										: "Your organization’s owners and admins can publish skills for you to use in the CLI."}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</>
			)}
			<Dialog
				open={editor !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditor(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>
							{editor && "id" in editor
								? manage
									? "Edit skill"
									: "View skill"
								: "Add organization skill"}
						</DialogTitle>
						<DialogDescription>
							Keep the skill name stable so developers can continue finding it.
							Changes apply to future CLI downloads.
						</DialogDescription>
					</DialogHeader>
					{editor &&
						("id" in editor ? (
							<ExistingSkill
								organizationId={organizationId}
								id={editor.id}
								readOnly={!manage}
								onSaved={saved}
							/>
						) : (
							<SkillForm
								organizationId={organizationId}
								initial={editor}
								readOnly={!manage}
								onSaved={saved}
							/>
						))}
				</DialogContent>
			</Dialog>
			<Dialog
				open={deleteSkill !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteSkill(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete {deleteSkill?.name}?</DialogTitle>
						<DialogDescription>
							This removes the skill from the organization. Developers will no
							longer be able to download it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteSkill(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => {
								if (deleteSkill) {
									remove.mutate(
										{
											params: { path: { organizationId, id: deleteSkill.id } },
										},
										{
											onSuccess: () => {
												setDeleteSkill(null);
												void refresh();
											},
											onError: (cause) => {
												setDeleteSkill(null);
												setError(errorMessage(cause));
											},
										},
									);
								}
							}}
						>
							Delete skill
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
