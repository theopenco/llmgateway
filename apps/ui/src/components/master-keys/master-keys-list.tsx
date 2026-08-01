"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, MoreHorizontal, PlusIcon } from "lucide-react";

import { CreateMasterKeyDialog } from "@/components/master-keys/create-master-key-dialog";
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
import { Button } from "@/lib/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { StatusBadge } from "@/lib/components/status-badge";
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
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

interface MasterKeysListProps {
	organizationId: string;
}

export function MasterKeysList({ organizationId }: MasterKeysListProps) {
	const api = useApi();
	const queryClient = useQueryClient();

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/master-keys",
		{ params: { query: { organizationId } } },
		{
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);

	const { mutate: deleteMutation } = api.useMutation(
		"delete",
		"/master-keys/{id}",
	);
	const { mutate: toggleStatusMutation } = api.useMutation(
		"patch",
		"/master-keys/{id}",
	);

	const invalidate = () => {
		const queryKey = api.queryOptions("get", "/master-keys", {
			params: { query: { organizationId } },
		}).queryKey;
		void queryClient.invalidateQueries({ queryKey });
	};

	const deleteKey = (id: string) =>
		deleteMutation(
			{ params: { path: { id } } },
			{
				onSuccess: () => {
					invalidate();
					toast({ title: "Master key deleted." });
				},
			},
		);

	const toggleStatus = (
		id: string,
		current: "active" | "inactive" | "deleted" | null,
	) => {
		const next = current === "active" ? "inactive" : "active";
		toggleStatusMutation(
			{
				params: { path: { id } },
				body: { status: next },
			},
			{
				onSuccess: () => {
					invalidate();
					toast({ title: "Master key status updated." });
				},
			},
		);
	};

	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<KeyRoundIcon className="h-10 w-10 text-gray-500 mb-4" />
				<p className="text-gray-400">Loading master keys...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<KeyRoundIcon className="h-10 w-10 text-gray-500 mb-4" />
				<p className="text-gray-400">
					Failed to load master keys. Please try again.
				</p>
			</div>
		);
	}

	const keys = data?.masterKeys ?? [];
	const planLimits = data?.planLimits;
	const limitReached =
		planLimits && planLimits.currentCount >= planLimits.maxKeys;

	if (keys.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<KeyRoundIcon className="h-10 w-10 text-gray-500 mb-4" />
				<p className="text-gray-400 mb-6">
					No master keys have been created yet.
				</p>
				<CreateMasterKeyDialog
					organizationId={organizationId}
					disabled={limitReached}
					disabledMessage={
						limitReached
							? `Maximum ${planLimits?.maxKeys} master keys per organization`
							: undefined
					}
				>
					<Button
						type="button"
						disabled={limitReached}
						className="flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<PlusIcon className="h-5 w-5" />
						Create Master Key
					</Button>
				</CreateMasterKeyDialog>
			</div>
		);
	}

	return (
		<>
			{planLimits && (
				<div className="mb-4 rounded-lg border bg-muted/30 p-4">
					<div className="flex items-center justify-between">
						<div className="text-sm text-muted-foreground">
							<span className="font-medium">Master Keys:</span>{" "}
							{planLimits.currentCount} of {planLimits.maxKeys} used
						</div>
						{limitReached && (
							<div className="text-xs text-amber-600 font-medium">
								Limit reached — contact us at contact@llmgateway.io to unlock
								more
							</div>
						)}
					</div>
				</div>
			)}

			<div className="hidden md:block overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="w-48">Master Key</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Created By</TableHead>
							<TableHead>Last Used</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{keys.map((key) => (
							<TableRow
								key={key.id}
								className="hover:bg-muted/30 transition-colors"
							>
								<TableCell className="font-medium text-sm">
									{key.description}
								</TableCell>
								<TableCell className="min-w-48 max-w-64">
									<span className="font-mono text-xs truncate block">
										{key.maskedToken}
									</span>
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
								<TableCell>
									<span className="text-muted-foreground">
										{key.creator?.name ?? key.creator?.email ?? "Unknown"}
									</span>
								</TableCell>
								<TableCell className="text-muted-foreground text-sm">
									{key.lastUsedAt
										? Intl.DateTimeFormat(undefined, {
												month: "short",
												day: "numeric",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											}).format(new Date(key.lastUsedAt))
										: "Never"}
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
															Delete this master key?
														</AlertDialogTitle>
														<AlertDialogDescription>
															This action cannot be undone. Any system using
															this master key will immediately lose access to
															the /v1/master/* API.
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

			<div className="md:hidden space-y-3">
				{keys.map((key) => (
					<div key={key.id} className="border rounded-lg p-3 space-y-3">
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<h3 className="font-medium text-sm">{key.description}</h3>
									<StatusBadge status={key.status} />
								</div>
								<div className="text-xs text-muted-foreground mt-1">
									{Intl.DateTimeFormat(undefined, {
										month: "short",
										day: "numeric",
										year: "numeric",
									}).format(new Date(key.createdAt))}
								</div>
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="sm" className="h-8 w-8 p-0">
										<MoreHorizontal className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>Actions</DropdownMenuLabel>
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
													Delete this master key?
												</AlertDialogTitle>
												<AlertDialogDescription>
													This action cannot be undone.
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
							<div className="text-xs text-muted-foreground mb-1">
								Master Key
							</div>
							<div className="font-mono text-xs break-all">
								{key.maskedToken}
							</div>
						</div>
						<div className="pt-2 border-t">
							<div className="text-xs text-muted-foreground mb-1">
								Last Used
							</div>
							<div className="text-sm">
								{key.lastUsedAt
									? Intl.DateTimeFormat(undefined, {
											month: "short",
											day: "numeric",
											year: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										}).format(new Date(key.lastUsedAt))
									: "Never"}
							</div>
						</div>
					</div>
				))}
			</div>
		</>
	);
}
