import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, CheckCircle, Plus } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useDefaultProject } from "@/hooks/useDefaultProject";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import { StatusBadge } from "@/lib/components/status-badge";
import { Step } from "@/lib/components/stepper";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

const formSchema = z.object({
	name: z.string().min(1, "Name is required"),
});

type FormValues = z.infer<typeof formSchema>;

export function ApiKeyStep() {
	const [isLoading, setIsLoading] = useState(false);
	const [apiKey, setApiKey] = useState<string | null>(null);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const { data: defaultProject, isError } = useDefaultProject();
	const api = useApi();

	// Fetch existing API keys
	const { data: apiKeysData, isLoading: isLoadingKeys } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: { projectId: defaultProject?.id || "" },
			},
		},
		{
			enabled: !!defaultProject?.id,
		},
	);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: "My First API Key",
		},
	});

	const createApiKey = api.useMutation("post", "/keys/api");

	interface ApiKeyType {
		id: string;
		createdAt: string;
		updatedAt: string;
		description: string;
		status: "active" | "inactive" | "deleted" | null;
		projectId: string;
		maskedToken: string;
	}

	const existingKeys =
		apiKeysData?.apiKeys?.filter(
			(key: ApiKeyType) => key.status !== "deleted",
		) || [];
	const hasExistingKeys = existingKeys.length > 0;

	async function onSubmit(values: FormValues) {
		setIsLoading(true);

		if (!defaultProject?.id) {
			toast({
				title: "Error",
				description: "No project available. Please try again.",
				variant: "destructive",
			});
			setIsLoading(false);
			return;
		}

		try {
			const response = await createApiKey.mutateAsync({
				body: {
					description: values.name,
					projectId: defaultProject.id,
					usageLimit: null,
				},
			});
			setApiKey(response.apiKey.token);
			setShowCreateForm(false);
			toast({
				title: "API key created",
				description: "Your API key has been created successfully.",
			});
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error
					? error.message
					: "Failed to create API key. Please try again.");
			toast({
				title: "Error",
				description: errorMessage,
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

	function copyToClipboard() {
		if (apiKey) {
			navigator.clipboard.writeText(apiKey);
			toast({
				title: "Copied to clipboard",
				description: "API key copied to clipboard",
			});
		}
	}

	if (isLoadingKeys) {
		return (
			<Step>
				<div className="flex flex-col gap-6">
					<div className="flex flex-col gap-2 text-center">
						<h1 className="text-2xl font-bold">API Keys</h1>
						<p className="text-muted-foreground">Loading your API keys...</p>
					</div>
				</div>
			</Step>
		);
	}

	return (
		<Step>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">
						{hasExistingKeys ? "API Keys" : "Create API Key"}
					</h1>
					<p className="text-muted-foreground">
						{hasExistingKeys
							? "Use these keys to authenticate requests to the LLM Gateway."
							: "Create an API key to authenticate requests to the LLM Gateway."}
					</p>
					{isError || !defaultProject ? (
						<p className="text-destructive text-sm">
							Unable to load project. Please try again.
						</p>
					) : (
						<p className="text-sm text-muted-foreground">
							Project: {defaultProject.name}
						</p>
					)}
				</div>

				<div className="space-y-4">
					{/* Show newly created API key */}
					{apiKey && (
						<Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
							<CardContent className="pt-6">
								<div className="flex flex-col gap-4">
									<div className="flex items-center gap-2 text-green-600">
										<CheckCircle className="h-5 w-5" />
										<span className="font-medium">API Key Created</span>
									</div>
									<div className="rounded-md bg-background p-4 border">
										<div className="flex items-center justify-between">
											<p className="text-sm font-medium break-all">{apiKey}</p>
											<Button
												variant="ghost"
												size="sm"
												onClick={copyToClipboard}
												type="button"
												className="h-8 w-8 p-0"
											>
												<Copy className="h-4 w-4" />
												<span className="sr-only">Copy API key</span>
											</Button>
										</div>
									</div>
									<div className="text-sm text-muted-foreground">
										<p className="font-medium">Important</p>
										<p className="mt-1">
											This key is only shown once. Copy it now and store it
											securely.
										</p>
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Show existing API keys */}
					{hasExistingKeys && !showCreateForm && (
						<Card>
							<CardContent>
								<div className="space-y-4">
									{/* Desktop Table */}
									<div className="hidden md:block">
										<div className="rounded-md border">
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Name</TableHead>
														<TableHead>Key</TableHead>
														<TableHead>Status</TableHead>
														<TableHead>Created</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{existingKeys.map((key) => (
														<TableRow key={key.id}>
															<TableCell className="font-medium">
																<span className="text-sm font-medium">
																	{key.description}
																</span>
															</TableCell>
															<TableCell>
																<span className="font-mono text-xs">
																	{key.maskedToken}
																</span>
															</TableCell>
															<TableCell>
																<StatusBadge
																	status={key.status}
																	variant="detailed"
																/>
															</TableCell>
															<TableCell>
																<TooltipProvider>
																	<Tooltip>
																		<TooltipTrigger asChild>
																			<span className="text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/50 hover:border-muted-foreground">
																				{Intl.DateTimeFormat(undefined, {
																					month: "short",
																					day: "numeric",
																					year: "numeric",
																				}).format(new Date(key.createdAt))}
																			</span>
																		</TooltipTrigger>
																		<TooltipContent>
																			<p className="max-w-xs text-xs whitespace-nowrap">
																				{Intl.DateTimeFormat(undefined, {
																					month: "short",
																					day: "numeric",
																					year: "numeric",
																					hour: "2-digit",
																					minute: "2-digit",
																				}).format(new Date(key.createdAt))}
																			</p>
																		</TooltipContent>
																	</Tooltip>
																</TooltipProvider>
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</div>
									</div>

									{/* Mobile Cards */}
									<div className="md:hidden space-y-3">
										{existingKeys.map((key) => (
											<div
												key={key.id}
												className="border rounded-lg p-3 space-y-3"
											>
												<div className="flex items-start justify-between">
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-2">
															<h3 className="font-medium text-sm">
																{key.description}
															</h3>
															<StatusBadge
																status={key.status}
																variant="detailed"
															/>
														</div>
														<div className="flex items-center gap-2 mt-1">
															<span className="text-xs text-muted-foreground">
																{Intl.DateTimeFormat(undefined, {
																	month: "short",
																	day: "numeric",
																	year: "numeric",
																	hour: "2-digit",
																	minute: "2-digit",
																}).format(new Date(key.createdAt))}
															</span>
														</div>
													</div>
												</div>
												<div className="pt-2 border-t">
													<div className="text-xs text-muted-foreground mb-1">
														API Key
													</div>
													<div className="font-mono text-xs break-all">
														{key.maskedToken}
													</div>
												</div>
											</div>
										))}
									</div>

									<div className="flex justify-center">
										<Button
											variant="outline"
											onClick={() => setShowCreateForm(true)}
											className="flex items-center gap-2"
										>
											<Plus className="h-4 w-4" />
											Create Another API Key
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Show create form (either when no existing keys or when requested) */}
					{(!hasExistingKeys || showCreateForm) && !apiKey && (
						<Card>
							<CardContent className="pt-6">
								<div className="space-y-4">
									{showCreateForm && (
										<div className="flex justify-between items-center">
											<h3 className="text-lg font-medium">
												Create New API Key
											</h3>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setShowCreateForm(false)}
											>
												Cancel
											</Button>
										</div>
									)}
									<Form {...form}>
										<form
											onSubmit={form.handleSubmit(onSubmit)}
											className="space-y-4"
										>
											<FormField
												control={form.control}
												name="name"
												render={({ field }) => (
													<FormItem>
														<FormLabel>Name</FormLabel>
														<FormControl>
															<Input placeholder="My API Key" {...field} />
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
											<Button
												type="submit"
												className="w-full"
												disabled={isLoading || isError || !defaultProject}
											>
												{isLoading ? "Creating..." : "Create API Key"}
											</Button>
										</form>
									</Form>
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			</div>
		</Step>
	);
}
