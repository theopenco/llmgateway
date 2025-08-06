import { useQueryClient } from "@tanstack/react-query";
import { EditIcon, KeyIcon, MoreHorizontal, PlusIcon } from "lucide-react";

import { CreateApiKeyDialog } from "./create-api-key-dialog";
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

import type { Project, ApiKey } from "@/lib/types";

interface ApiKeysListProps {
	selectedProject: Project | null;
	initialData: ApiKey[];
}

export function ApiKeysList({
	selectedProject,
	initialData,
}: ApiKeysListProps) {
	const queryClient = useQueryClient();
	const api = useApi();

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
					createdAt:
						key.createdAt instanceof Date
							? key.createdAt.toISOString()
							: key.createdAt,
					updatedAt:
						key.updatedAt instanceof Date
							? key.updatedAt.toISOString()
							: key.updatedAt,
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

	const keys = data?.apiKeys.filter((key) => key.status !== "deleted");

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

	if (keys!.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">No API keys have been created yet.</p>
				<CreateApiKeyDialog selectedProject={selectedProject}>
					<Button
						type="button"
						className="cursor-pointer flex items-center gap-2 bg-white text-black px-4 py-2 rounded-md hover:bg-gray-200"
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
			{/* Desktop Table */}
			<div className="hidden md:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>API Key</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Usage</TableHead>
							<TableHead>Usage Limit</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{keys!.map((key) => (
							<TableRow key={key.id}>
								<TableCell className="font-medium">{key.description}</TableCell>
								<TableCell>
									<div className="flex items-center space-x-2">
										<span className="font-mono text-xs">{key.maskedToken}</span>
									</div>
								</TableCell>
								<TableCell>{key.createdAt}</TableCell>
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
											<DropdownMenuItem
												onClick={() => toggleStatus(key.id, key.status)}
											>
												{key.status === "active" ? "Disable" : "Enable"} Key
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
				{keys!.map((key) => (
					<div key={key.id} className="border rounded-lg p-4 space-y-3">
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<h3 className="font-medium text-sm">{key.description}</h3>
								<div className="flex items-center gap-2 mt-1">
									<Badge
										variant={
											key.status === "active"
												? "default"
												: key.status === "deleted"
													? "destructive"
													: "secondary"
										}
										className="text-xs"
									>
										{key.status}
									</Badge>
									<span className="text-xs text-muted-foreground">
										{key.createdAt}
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
									<DropdownMenuItem
										onClick={() => toggleStatus(key.id, key.status)}
									>
										{key.status === "active" ? "Disable" : "Enable"} Key
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
					</div>
				))}
			</div>
		</>
	);
}
