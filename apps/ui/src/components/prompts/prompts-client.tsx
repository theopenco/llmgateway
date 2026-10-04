"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FileText, Rocket } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
	PromptMessagesEditor,
	promptDraftVariables,
	type PromptMessageDraft,
} from "@/components/prompts/prompt-messages-editor";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Checkbox } from "@/lib/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { Time } from "@llmgateway/shared";

const DEFAULT_MESSAGES: PromptMessageDraft[] = [
	{ role: "system", content: "You are a helpful assistant for {{product}}." },
	{ role: "user", content: "{{question}}" },
];

function errorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "Something went wrong";
}

function VariableChips({ variables }: { variables: string[] }) {
	if (variables.length === 0) {
		return <span className="text-sm text-muted-foreground">No variables</span>;
	}
	return (
		<div className="flex flex-wrap gap-1.5">
			{variables.map((name) => (
				<Badge key={name} variant="secondary" className="font-mono">
					{name}
				</Badge>
			))}
		</div>
	);
}

function UsageSnippet({
	name,
	variables,
}: {
	name: string;
	variables: string[];
}) {
	const [copied, setCopied] = useState(false);
	const body = JSON.stringify(
		{
			prompt: {
				id: name,
				variables: Object.fromEntries(variables.map((v) => [v, "..."])),
			},
		},
		null,
		2,
	);
	const snippet = `curl https://api.llmgateway.io/v1/chat/completions \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`;
	return (
		<div className="relative">
			<pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">
				{snippet}
			</pre>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="absolute right-2 top-2"
				aria-label="Copy snippet"
				onClick={async () => {
					await navigator.clipboard.writeText(snippet);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				}}
			>
				{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
			</Button>
		</div>
	);
}

function CreatePromptDialog({
	projectId,
	onCreated,
}: {
	projectId: string;
	onCreated: (id: string) => void;
}) {
	const api = useApi();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [model, setModel] = useState("");
	const [messages, setMessages] =
		useState<PromptMessageDraft[]>(DEFAULT_MESSAGES);
	const create = api.useMutation("post", "/prompts");

	const submit = async () => {
		try {
			const result = await create.mutateAsync({
				body: {
					projectId,
					name,
					description: description || null,
					model: model || null,
					messages,
				},
			});
			setOpen(false);
			setName("");
			setDescription("");
			setModel("");
			setMessages(DEFAULT_MESSAGES);
			onCreated(result.prompt.id);
			toast({ title: "Prompt created", description: "Version 1 is live." });
		} catch (error) {
			toast({
				title: "Could not create prompt",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<FileText className="mr-2 h-4 w-4" />
					New prompt
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>New prompt</DialogTitle>
					<DialogDescription>
						Version 1 goes live immediately. Reference it from any request by
						name.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="prompt-name">Name</Label>
							<Input
								id="prompt-name"
								value={name}
								placeholder="support-reply"
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="prompt-model">Default model (optional)</Label>
							<Input
								id="prompt-model"
								value={model}
								placeholder="gpt-4o-mini"
								onChange={(event) => setModel(event.target.value)}
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="prompt-description">Description (optional)</Label>
						<Input
							id="prompt-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label>Messages</Label>
						<PromptMessagesEditor messages={messages} onChange={setMessages} />
					</div>
					<div className="space-y-1">
						<Label>Variables</Label>
						<VariableChips variables={promptDraftVariables(messages)} />
					</div>
				</div>
				<DialogFooter>
					<Button
						onClick={submit}
						disabled={
							!name ||
							create.isPending ||
							messages.some((message) => !message.content.trim())
						}
					>
						{create.isPending ? "Creating..." : "Create prompt"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function PromptDetail({ promptId }: { promptId: string }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const detail = api.useQuery("get", "/prompts/{id}", {
		params: { path: { id: promptId } },
	});
	const [messages, setMessages] = useState<PromptMessageDraft[]>([]);
	const [model, setModel] = useState("");
	const [commitMessage, setCommitMessage] = useState("");
	const [deploy, setDeploy] = useState(true);
	const createVersion = api.useMutation("post", "/prompts/{id}/versions");
	const deployVersion = api.useMutation("post", "/prompts/{id}/deploy");

	const prompt = detail.data?.prompt;
	const versions = useMemo(() => detail.data?.versions ?? [], [detail.data]);
	const production = versions.find(
		(version) => version.version === prompt?.productionVersion,
	);

	useEffect(() => {
		const base = production ?? versions[0];
		if (base) {
			setMessages(base.messages);
			setModel(base.model ?? "");
		}
	}, [production, versions]);

	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/prompts/{id}", {
				params: { path: { id: promptId } },
			}).queryKey,
		});
		await queryClient.invalidateQueries({ queryKey: ["get", "/prompts"] });
	};

	if (!prompt) {
		return (
			<Card>
				<CardContent className="p-6 text-sm text-muted-foreground">
					Loading prompt...
				</CardContent>
			</Card>
		);
	}

	const saveVersion = async () => {
		try {
			const result = await createVersion.mutateAsync({
				params: { path: { id: prompt.id } },
				body: {
					messages,
					model: model || null,
					commitMessage: commitMessage || null,
					deploy,
				},
			});
			setCommitMessage("");
			await refresh();
			toast({
				title: `Version ${result.version.version} saved`,
				description: deploy ? "Now serving production traffic." : undefined,
			});
		} catch (error) {
			toast({
				title: "Could not save version",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const promote = async (version: number) => {
		await deployVersion.mutateAsync({
			params: { path: { id: prompt.id } },
			body: { version },
		});
		await refresh();
		toast({ title: `Version ${version} deployed` });
	};

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<span className="font-mono">{prompt.name}</span>
						{prompt.productionVersion ? (
							<Badge>v{prompt.productionVersion} live</Badge>
						) : null}
					</CardTitle>
					{prompt.description ? (
						<CardDescription>{prompt.description}</CardDescription>
					) : null}
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label>Messages</Label>
						<PromptMessagesEditor messages={messages} onChange={setMessages} />
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="version-model">Default model</Label>
							<Input
								id="version-model"
								value={model}
								placeholder="Set by the request"
								onChange={(event) => setModel(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="version-commit">Change note</Label>
							<Input
								id="version-commit"
								value={commitMessage}
								placeholder="What changed?"
								onChange={(event) => setCommitMessage(event.target.value)}
							/>
						</div>
					</div>
					<div className="space-y-1">
						<Label>Variables</Label>
						<VariableChips variables={promptDraftVariables(messages)} />
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<label className="flex items-center gap-2 text-sm">
							<Checkbox
								checked={deploy}
								onCheckedChange={(value) => setDeploy(value === true)}
							/>
							Deploy to production after saving
						</label>
						<Button
							onClick={saveVersion}
							disabled={
								createVersion.isPending ||
								messages.some((message) => !message.content.trim())
							}
						>
							{createVersion.isPending ? "Saving..." : "Save new version"}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Versions</CardTitle>
					<CardDescription>
						Versions are immutable. Pin one with{" "}
						<code className="text-xs">prompt.version</code> or deploy it to make
						it the default.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					{versions.map((version) => {
						const live = version.version === prompt.productionVersion;
						return (
							<div
								key={version.id}
								className={cn(
									"flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3",
									live && "border-primary/50 bg-primary/5",
								)}
							>
								<div className="space-y-0.5">
									<div className="flex items-center gap-2 font-medium">
										v{version.version}
										{live ? <Badge>Production</Badge> : null}
										{version.model ? (
											<Badge variant="outline" className="font-mono">
												{version.model}
											</Badge>
										) : null}
									</div>
									<div className="text-sm text-muted-foreground">
										{version.commitMessage ?? "No change note"} ·{" "}
										<Time date={version.createdAt} />
									</div>
								</div>
								{live ? null : (
									<Button
										variant="outline"
										size="sm"
										disabled={deployVersion.isPending}
										onClick={() => promote(version.version)}
									>
										<Rocket className="mr-1 h-4 w-4" />
										Deploy
									</Button>
								)}
							</div>
						);
					})}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Use it</CardTitle>
					<CardDescription>
						Rendered messages go before any messages you send. The prompt's
						model and parameters apply only when the request leaves them unset.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<UsageSnippet
						name={prompt.name}
						variables={promptDraftVariables(production?.messages ?? messages)}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

export function PromptsClient() {
	const api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const { selectedProject } = useDashboardNavigation();
	const projectId = selectedProject?.id ?? "";
	const selectedId = searchParams.get("prompt");

	const list = api.useQuery(
		"get",
		"/prompts",
		{ params: { query: { projectId } } },
		{ enabled: !!projectId },
	);
	const prompts = useMemo(() => list.data?.prompts ?? [], [list.data]);

	const select = (id: string) => router.replace(`${pathname}?prompt=${id}`);

	useEffect(() => {
		if (!selectedId && prompts[0]) {
			router.replace(`${pathname}?prompt=${prompts[0].id}`);
		}
	}, [selectedId, prompts, pathname, router]);

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Prompts</h2>
						<p className="text-muted-foreground">
							Version prompt templates and ship changes without redeploying your
							app
						</p>
					</div>
					{projectId ? (
						<CreatePromptDialog
							projectId={projectId}
							onCreated={async (id) => {
								await queryClient.invalidateQueries({
									queryKey: ["get", "/prompts"],
								});
								select(id);
							}}
						/>
					) : null}
				</div>

				{list.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading prompts...</p>
				) : prompts.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-2 p-10 text-center">
							<FileText className="h-8 w-8 text-muted-foreground" />
							<p className="font-medium">No prompts yet</p>
							<p className="max-w-md text-sm text-muted-foreground">
								Create a prompt, then call it with{" "}
								<code className="text-xs">
									{'"prompt": { "id": "<name>" }'}
								</code>{" "}
								instead of sending the messages from your code.
							</p>
						</CardContent>
					</Card>
				) : (
					<div className="grid gap-4 lg:grid-cols-[280px_1fr]">
						<div className="space-y-2">
							{prompts.map((prompt) => (
								<button
									key={prompt.id}
									type="button"
									onClick={() => select(prompt.id)}
									className={cn(
										"w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted",
										selectedId === prompt.id && "border-primary bg-primary/5",
									)}
								>
									<div className="font-mono text-sm font-medium">
										{prompt.name}
									</div>
									<div className="mt-1 text-xs text-muted-foreground">
										{prompt.productionVersion
											? `v${prompt.productionVersion} live`
											: "Not deployed"}{" "}
										· {prompt.latestVersion} version
										{prompt.latestVersion === 1 ? "" : "s"}
									</div>
								</button>
							))}
						</div>
						{selectedId ? <PromptDetail promptId={selectedId} /> : null}
					</div>
				)}
			</div>
		</div>
	);
}
