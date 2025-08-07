import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Key, CheckCircle, Plus } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useDefaultProject } from "@/hooks/useDefaultProject";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import { Step } from "@/lib/components/stepper";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
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
		} catch {
			toast({
				title: "Error",
				description: "Failed to create API key. Please try again.",
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
						{hasExistingKeys ? "Your API Keys" : "Create Your API Key"}
					</h1>
					<p className="text-muted-foreground">
						{hasExistingKeys
							? "Great! You already have API keys set up. You can use these to make requests to the LLM Gateway."
							: "You'll need an API key to make requests to the LLM Gateway."}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Key className="h-5 w-5" />
							API Key{hasExistingKeys ? "s" : ""}
						</CardTitle>
						<CardDescription>
							{hasExistingKeys
								? "Your existing API keys are listed below. You can create additional keys if needed."
								: "Create an API key to authenticate your requests to the LLM Gateway."}
							{isError || !defaultProject ? (
								<span className="text-destructive block mt-1">
									Unable to load project. Please try again.
								</span>
							) : (
								<span className="block mt-1">
									Project: {defaultProject.name}
								</span>
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{/* Show newly created API key */}
						{apiKey && (
							<div className="mb-6">
								<div className="flex flex-col gap-4">
									<div className="flex items-center gap-2 text-green-600">
										<CheckCircle className="h-5 w-5" />
										<span className="font-medium">New API Key Created!</span>
									</div>
									<div className="rounded-md bg-muted p-4">
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
									<div className="text-muted-foreground rounded-md bg-yellow-100 dark:bg-yellow-950 p-4 text-sm">
										<p className="font-medium text-yellow-800 dark:text-yellow-300">
											Important
										</p>
										<p className="mt-1">
											This API key will only be shown once. Make sure to copy it
											now and store it securely. You can always create new API
											keys later.
										</p>
									</div>
								</div>
							</div>
						)}

						{/* Show existing API keys */}
						{hasExistingKeys && !showCreateForm && (
							<div className="space-y-4">
								<div className="rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Name</TableHead>
												<TableHead>API Key</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Created</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{existingKeys.map((key) => (
												<TableRow key={key.id}>
													<TableCell className="font-medium">
														{key.description}
													</TableCell>
													<TableCell>
														<span className="font-mono text-xs">
															{key.maskedToken}
														</span>
													</TableCell>
													<TableCell>
														<Badge
															variant={
																key.status === "active"
																	? "default"
																	: key.status === "deleted"
																		? "destructive"
																		: "secondary"
															}
														>
															{key.status}
														</Badge>
													</TableCell>
													<TableCell className="text-sm text-muted-foreground">
														{key.createdAt}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
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
						)}

						{/* Show create form (either when no existing keys or when requested) */}
						{(!hasExistingKeys || showCreateForm) && !apiKey && (
							<div className="space-y-4">
								{showCreateForm && (
									<div className="flex justify-between items-center">
										<h3 className="text-lg font-medium">Create New API Key</h3>
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
													<FormLabel>API Key Name</FormLabel>
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
						)}
					</CardContent>
				</Card>
			</div>
		</Step>
	);
}
