import { useQueryClient } from "@tanstack/react-query";
import {
	EditIcon,
	KeyIcon,
	MoreHorizontal,
	PlusIcon,
	Shield,
	Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { StatusBadge } from "@/lib/components/status-badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { IamRulesDialog } from "./iam-rules-dialog";

import type { ApiKey, Project } from "@/lib/types";

interface ApiKeysListProps {
	selectedProject: Project | null;
	initialData: ApiKey[];
}

type StatusFilter = "all" | "active" | "inactive";

export function ApiKeysList({
	selectedProject,
	initialData,
}: ApiKeysListProps) {
	const queryClient = useQueryClient();
	const api = useApi();
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

	// All hooks must be called before any conditional returns
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: { projectId: selectedProject?.id || "" },
			},
		},
		{
			enabled: !!selectedProject?.id,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
			refetchOnMount: false,
			refetchInterval: false,
			initialData: {
				apiKeys: initialData.map((key) => ({
					...key,
					maskedToken: key.maskedToken,
				})),
			},
		},
	);

	const { mutate: deleteMutation } = api.useMutation(
		"delete",
		"/keys/api/{id}",
	);
	const { mutate: toggleKeyStatus } = api.useMutation(
		"patch",
		"/keys/api/{id}",
	);

	const { mutate: updateKeyUsageLimitMutation } = api.useMutation(
		"patch",
		"/keys/api/limit/{id}",
	);

	const allKeys = data?.apiKeys.filter((key) => key.status !== "deleted") || [];
	const activeKeys = allKeys.filter((key) => key.status === "active");
	const inactiveKeys = allKeys.filter((key) => key.status === "inactive");
	const planLimits = data?.planLimits;

	const filteredKeys = (() => {
		switch (statusFilter) {
			case "active":
				return activeKeys;
			case "inactive":
				return inactiveKeys;
			case "all":
			default:
				return allKeys;
		}
	})();

	// Auto-switch to a tab with content if current tab becomes empty
	useEffect(() => {
		if (filteredKeys.length === 0 && allKeys.length > 0) {
			if (statusFilter === "active" && inactiveKeys.length > 0) {
				setStatusFilter("inactive");
			} else if (statusFilter === "inactive" && activeKeys.length > 0) {
				setStatusFilter("active");
			} else if (statusFilter !== "all") {
				setStatusFilter("all");
			}
		}
	}, [
		filteredKeys.length,
		allKeys.length,
		activeKeys.length,
		inactiveKeys.length,
		statusFilter,
	]);

	// Show message if no project is selected
	if (!selectedProject) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">
					Please select a project to view API keys.
				</p>
			</div>
		);
	}

	// Handle loading state
	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">Loading API keys...</p>
			</div>
		);
	}

	// Handle error state
	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">
					Failed to load API keys. Please try again.
				</p>
			</div>
		);
	}

	const deleteKey = (id: string) => {
		deleteMutation(
			{
				params: {
					path: { id },
				},
			},
			{
				onSuccess: () => {
					const queryKey = api.queryOptions("get", "/keys/api", {
						params: {
							query: { projectId: selectedProject.id },
						},
					}).queryKey;

					queryClient.invalidateQueries({ queryKey });

					toast({ title: "API key deleted successfully." });
				},
				onError: () => {
					toast({ title: "Failed to delete API key.", variant: "destructive" });
				},
			},
		);
	};

	const toggleStatus = (
		id: string,
		currentStatus: "active" | "inactive" | "deleted" | null,
	) => {
		const newStatus = currentStatus === "active" ? "inactive" : "active";

		toggleKeyStatus(
			{
				params: {
					path: { id },
				},
				body: {
					status: newStatus,
				},
			},
			{
				onSuccess: () => {
					const queryKey = api.queryOptions("get", "/keys/api", {
						params: {
							query: { projectId: selectedProject.id },
						},
					}).queryKey;

					queryClient.invalidateQueries({ queryKey });

					toast({
						title: "API Key Status Updated",
						description: "The API key status has been updated.",
					});
				},
				onError: () => {
					toast({ title: "Failed to update API key.", variant: "destructive" });
				},
			},
		);
	};

	const updateKeyUsageLimit = (id: string, newUsageLimit: string | null) => {
		updateKeyUsageLimitMutation(
			{
				params: {
					path: { id },
				},
				body: {
					usageLimit: newUsageLimit,
				},
			},
			{
				onSuccess: () => {
					const queryKey = api.queryOptions("get", "/keys/api", {
						params: {
							query: { projectId: selectedProject.id },
						},
					}).queryKey;

					queryClient.invalidateQueries({ queryKey });

					toast({
						title: "API Key Usage Limit Updated",
						description: "The API key usage limit has been updated.",
					});
				},
				onError: () => {
					toast({ title: "Failed to update API key.", variant: "destructive" });
				},
			},
		);
	};

	const bulkActivateInactive = () => {
		inactiveKeys.forEach((key) => {
			toggleKeyStatus(
				{
					params: {
						path: { id: key.id },
					},
					body: {
						status: "active",
					},
				},
				{
					onSuccess: () => {
						const queryKey = api.queryOptions("get", "/keys/api", {
							params: {
								query: { projectId: selectedProject!.id },
							},
						}).queryKey;
						queryClient.invalidateQueries({ queryKey });
					},
				},
			);
		});

		// Switch to active tab to show the results
		setStatusFilter("active");

		toast({
			title: "Activating Keys",
			description: `${inactiveKeys.length} key${inactiveKeys.length !== 1 ? "s" : ""} are being activated.`,
		});
	};

	if (allKeys.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">No API keys have been created yet.</p>
				<CreateApiKeyDialog
					selectedProject={selectedProject}
					disabled={
						planLimits ? planLimits.currentCount >= planLimits.maxKeys : false
					}
					disabledMessage={
						planLimits
							? `${planLimits.plan === "pro" ? "Pro" : "Free"} plan allows maximum ${planLimits.maxKeys} API keys per project`
							: undefined
					}
				>
					<Button
						type="button"
						disabled={
							planLimits ? planLimits.currentCount >= planLimits.maxKeys : false
						}
						className="cursor-pointer flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<PlusIcon className="h-5 w-5" />
						Create API Key
					</Button>
				</CreateApiKeyDialog>
			</div>
		);
	}

	return (
		<>
			{/* Status Filter Tabs */}
			<div className="mb-6">
				<Tabs
					value={statusFilter}
					onValueChange={(value) => setStatusFilter(value as StatusFilter)}
				>
					<TabsList className="flex space-x-2 w-full md:w-fit">
						<TabsTrigger value="all">
							All{" "}
							<Badge
								variant={statusFilter === "all" ? "default" : "outline"}
								className="text-xs"
							>
								{allKeys.length}
							</Badge>
						</TabsTrigger>
						{activeKeys.length > 0 && (
							<TabsTrigger value="active">
								Active{" "}
								<Badge
									variant={statusFilter === "active" ? "default" : "outline"}
									className="text-xs"
								>
									{activeKeys.length}
								</Badge>
							</TabsTrigger>
						)}
						{inactiveKeys.length > 0 && (
							<TabsTrigger value="inactive">
								Inactive{" "}
								<Badge
									variant={statusFilter === "inactive" ? "default" : "outline"}
									className="text-xs"
								>
									{inactiveKeys.length}
								</Badge>
							</TabsTrigger>
						)}
					</TabsList>
				</Tabs>
			</div>

			{/* Plan Limits Display */}
			{planLimits && (
				<div className="mb-4 rounded-lg border bg-muted/30 p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-4">
							<div className="text-sm text-muted-foreground">
								<span className="font-medium">API Keys:</span>{" "}
								{planLimits.currentCount} of {planLimits.maxKeys} used
							</div>
							<div className="text-sm text-muted-foreground">
								<span className="font-medium">Plan:</span>{" "}
								{planLimits.plan === "pro" ? "Pro" : "Free"}
							</div>
						</div>
						{planLimits.currentCount >= planLimits.maxKeys && (
							<div className="text-xs text-amber-600 font-medium">
								Limit reached
							</div>
						)}
					</div>
					{planLimits.plan === "free" && planLimits.currentCount >= 3 && (
						<div className="mt-2 text-xs text-muted-foreground">
							💡 Upgrade to Pro plan to create up to 20 API keys per project
						</div>
					)}
				</div>
			)}

			{/* Inactive Keys Summary Bar */}
			{statusFilter === "active" && inactiveKeys.length > 0 && (
				<div className="mb-4 rounded-lg border bg-muted/30 p-2">
					<div className="flex flex-col space-y-2 md:space-y-0 md:flex-row md:items-center justify-between">
						<div className="flex items-center gap-2">
							<div className="text-sm text-muted-foreground">
								💤 {inactiveKeys.length} inactive key
								{inactiveKeys.length !== 1 ? "s" : ""}
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setStatusFilter("inactive")}
							>
								Manage
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={bulkActivateInactive}
								className="flex items-center gap-1"
							>
								<Zap className="h-3 w-3" />
								Activate All
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* Bulk Actions Bar for Inactive Tab */}
			{statusFilter === "inactive" && inactiveKeys.length > 0 && (
				<div className="mb-4 rounded-lg border bg-muted/30 p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<div className="text-sm text-muted-foreground">
								💤 {inactiveKeys.length} inactive key
								{inactiveKeys.length !== 1 ? "s" : ""} selected
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="default"
								size="sm"
								onClick={bulkActivateInactive}
								className="flex items-center gap-1"
							>
								<Zap className="h-3 w-3" />
								Activate All
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* Desktop Table */}
			<div className="hidden md:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>API Key</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Usage</TableHead>
							<TableHead>Usage Limit</TableHead>
							<TableHead>IAM Rules</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filteredKeys.map((key) => (
							<TableRow
								key={key.id}
								className="hover:bg-muted/30 transition-colors"
							>
								<TableCell className="font-medium">
									<span className="text-sm font-medium">{key.description}</span>
								</TableCell>
								<TableCell>
									<div className="flex items-center space-x-2">
										<span className="font-mono text-xs">{key.maskedToken}</span>
									</div>
								</TableCell>
								<TableCell>
									<StatusBadge status={key.status} variant="detailed" />
								</TableCell>
								<TableCell>
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
								</TableCell>
								<TableCell>${Number(key.usage).toFixed(2)}</TableCell>
								<TableCell>
									<Dialog>
										<DialogTrigger asChild>
											<Button
												variant="outline"
												size="sm"
												className="min-w-28 flex justify-between"
											>
												{key.usageLimit
													? `$${Number(key.usageLimit).toFixed(2)}`
													: "No limit"}
												<EditIcon />
											</Button>
										</DialogTrigger>
										<DialogContent>
											<form
												onSubmit={(e) => {
													e.preventDefault();
													const formData = new FormData(
														e.target as HTMLFormElement,
													);
													const newUsageLimit = formData.get("limit") as
														| string
														| null;
													if (newUsageLimit === key.usageLimit) {
														return;
													}
													if (newUsageLimit === "") {
														updateKeyUsageLimit(key.id, null);
													} else {
														updateKeyUsageLimit(key.id, newUsageLimit);
													}
												}}
											>
												<DialogHeader>
													<DialogTitle>Edit key credit limit</DialogTitle>
													<DialogDescription>
														Set a credit limit for this key. When key usage is
														past this limit, requests using this key will return
														an error.
													</DialogDescription>
												</DialogHeader>
												<div className="grid gap-3 pt-8">
													<Label htmlFor="limit">
														Usage Limit (leave empty for no limit)
													</Label>
													<div className="relative">
														<span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
															$
														</span>
														<Input
															className="pl-6"
															id="limit"
															name="limit"
															defaultValue={
																key.usageLimit ? Number(key.usageLimit) : ""
															}
															type="number"
														/>
													</div>
													<div className="text-muted-foreground text-sm">
														Usage includes both usage from LLM Gateway credits
														and usage from your own provider keys when
														applicable.
													</div>
												</div>
												<DialogFooter className="pt-8">
													<DialogClose asChild>
														<Button variant="outline">Cancel</Button>
													</DialogClose>
													<DialogClose asChild>
														<Button type="submit">Save changes</Button>
													</DialogClose>
												</DialogFooter>
											</form>
										</DialogContent>
									</Dialog>
								</TableCell>
								<TableCell>
									{key.iamRules && key.iamRules.length > 0 ? (
										<IamRulesDialog apiKey={key}>
											<Button variant="outline" size="sm" className="text-xs">
												{
													key.iamRules.filter(
														(rule) => rule.status === "active",
													).length
												}{" "}
												rule
												{key.iamRules.filter((rule) => rule.status === "active")
													.length !== 1
													? "s"
													: ""}
											</Button>
										</IamRulesDialog>
									) : (
										<IamRulesDialog apiKey={key}>
											<Button
												variant="ghost"
												size="sm"
												className="text-xs text-muted-foreground"
											>
												No rules
											</Button>
										</IamRulesDialog>
									)}
								</TableCell>
								<TableCell className="text-right">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon" className="h-8 w-8">
												<MoreHorizontal className="h-4 w-4" />
												<span className="sr-only">Open menu</span>
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuLabel>Actions</DropdownMenuLabel>
											<IamRulesDialog apiKey={key}>
												<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
													<Shield className="mr-2 h-4 w-4" />
													Manage IAM Rules
												</DropdownMenuItem>
											</IamRulesDialog>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												onClick={() => toggleStatus(key.id, key.status)}
											>
												{key.status === "active" ? "Deactivate" : "Activate"}{" "}
												Key
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<AlertDialog>
												<AlertDialogTrigger asChild>
													<DropdownMenuItem
														onSelect={(e) => e.preventDefault()}
														className="text-destructive focus:text-destructive"
													>
														Delete
													</DropdownMenuItem>
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>
															Are you absolutely sure?
														</AlertDialogTitle>
														<AlertDialogDescription>
															This action cannot be undone. This will
															permanently delete the API key and it will no
															longer be able to access your account.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															onClick={() => deleteKey(key.id)}
														>
															Delete
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</DropdownMenuContent>
									</DropdownMenu>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{/* Mobile Cards */}
			<div className="md:hidden space-y-3">
				{filteredKeys.map((key) => (
					<div key={key.id} className="border rounded-lg p-3 space-y-3">
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<h3 className="font-medium text-sm">{key.description}</h3>
									<StatusBadge status={key.status} />
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
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
										<MoreHorizontal className="h-4 w-4" />
										<span className="sr-only">Open menu</span>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>Actions</DropdownMenuLabel>
									<IamRulesDialog apiKey={key}>
										<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
											<Shield className="mr-2 h-4 w-4" />
											Manage IAM Rules
										</DropdownMenuItem>
									</IamRulesDialog>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onClick={() => toggleStatus(key.id, key.status)}
									>
										{key.status === "active" ? "Deactivate" : "Activate"} Key
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<DropdownMenuItem
												onSelect={(e) => e.preventDefault()}
												className="text-destructive focus:text-destructive"
											>
												Delete
											</DropdownMenuItem>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>
													Are you absolutely sure?
												</AlertDialogTitle>
												<AlertDialogDescription>
													This action cannot be undone. This will permanently
													delete the API key and it will no longer be able to
													access your account.
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogAction onClick={() => deleteKey(key.id)}>
													Delete
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
						<div className="pt-2 border-t">
							<div className="text-xs text-muted-foreground mb-1">API Key</div>
							<div className="font-mono text-xs break-all">
								{key.maskedToken}
							</div>
						</div>
						<div className="pt-2 border-t grid grid-cols-2">
							<div className="py-1">
								<div className="text-xs text-muted-foreground mb-1">Usage</div>
								<div className="font-mono text-xs break-all">
									${Number(key.usage).toFixed(2)}
								</div>
							</div>
							<div>
								<Dialog>
									<DialogTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											className="min-w-32 flex justify-between h-full py-1"
										>
											<div className="text-left">
												<div className="text-xs text-muted-foreground mb-1">
													Usage Limit
												</div>
												<div className="font-mono text-xs break-all">
													{key.usageLimit
														? `$${Number(key.usageLimit).toFixed(2)}`
														: "No limit"}
												</div>
											</div>
											<EditIcon />
										</Button>
									</DialogTrigger>
									<DialogContent>
										<form
											onSubmit={(e) => {
												e.preventDefault();
												const formData = new FormData(
													e.target as HTMLFormElement,
												);
												const newUsageLimit = formData.get("limit") as
													| string
													| null;
												if (newUsageLimit === key.usageLimit) {
													return;
												}
												if (newUsageLimit === "") {
													updateKeyUsageLimit(key.id, null);
												} else {
													updateKeyUsageLimit(key.id, newUsageLimit);
												}
											}}
										>
											<DialogHeader>
												<DialogTitle>Edit key credit limit</DialogTitle>
												<DialogDescription>
													Set a credit limit for this key. When key usage is
													past this limit, requests using this key will return
													an error.
												</DialogDescription>
											</DialogHeader>
											<div className="grid gap-3 pt-8">
												<Label htmlFor="limit">
													Usage Limit (leave empty for no limit)
												</Label>
												<div className="relative">
													<span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
														$
													</span>
													<Input
														className="pl-6"
														id="limit"
														name="limit"
														defaultValue={
															key.usageLimit ? Number(key.usageLimit) : ""
														}
														type="number"
													/>
												</div>
												<div className="text-muted-foreground text-sm">
													Usage includes both usage from LLM Gateway credits and
													usage from your own provider keys when applicable.
												</div>
											</div>
											<DialogFooter className="pt-8">
												<DialogClose asChild>
													<Button variant="outline">Cancel</Button>
												</DialogClose>
												<DialogClose asChild>
													<Button type="submit">Save changes</Button>
												</DialogClose>
											</DialogFooter>
										</form>
									</DialogContent>
								</Dialog>
							</div>
						</div>
						<div className="pt-2 border-t">
							<div className="text-xs text-muted-foreground mb-1">
								IAM Rules
							</div>
							<div className="flex items-center">
								{key.iamRules && key.iamRules.length > 0 ? (
									<IamRulesDialog apiKey={key}>
										<Button variant="outline" size="sm" className="text-xs h-7">
											{
												key.iamRules.filter((rule) => rule.status === "active")
													.length
											}{" "}
											active rule
											{key.iamRules.filter((rule) => rule.status === "active")
												.length !== 1
												? "s"
												: ""}
										</Button>
									</IamRulesDialog>
								) : (
									<IamRulesDialog apiKey={key}>
										<Button
											variant="ghost"
											size="sm"
											className="text-xs text-muted-foreground h-7"
										>
											No rules configured
										</Button>
									</IamRulesDialog>
								)}
							</div>
						</div>
					</div>
				))}
			</div>
		</>
	);
}
