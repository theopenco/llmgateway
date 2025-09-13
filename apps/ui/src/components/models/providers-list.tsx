"use client";

// import { Edit, MoreHorizontal, Trash } from "lucide-react";
import { useState } from "react";
// import { toast } from "sonner";

// import { EditProviderDialog } from "@/components/models/edit-provider-dialog";
// import {
// 	AlertDialog,
// 	AlertDialogAction,
// 	AlertDialogCancel,
// 	AlertDialogContent,
// 	AlertDialogDescription,
// 	AlertDialogFooter,
// 	AlertDialogHeader,
// 	AlertDialogTitle,
// 	AlertDialogTrigger,
// } from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
// import { Button } from "@/lib/components/button";
// import {
// 	DropdownMenu,
// 	DropdownMenuContent,
// 	DropdownMenuItem,
// 	DropdownMenuLabel,
// 	DropdownMenuSeparator,
// 	DropdownMenuTrigger,
// } from "@/lib/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";

import { providers as defaultProviders } from "@llmgateway/models";

export function ProvidersList() {
	const [providersList, _setProvidersList] = useState(() =>
		defaultProviders.map((provider, index) => ({
			id: index.toString(),
			name: provider.name,
			baseUrl: `https://${provider.id}.api.fake/v1`,
			models: [],
			status: "connected",
			priority: "medium",
		})),
	);

	// const [editingProvider, setEditingProvider] = useState<
	// 	(typeof providersList)[0] | null
	// >(null);
	// const [editDialogOpen, setEditDialogOpen] = useState(false);

	// const deleteProvider = (id: string) => {
	// 	setProvidersList((prev) => prev.filter((p) => p.id !== id));
	// 	toast("Provider Deleted", {
	// 		description: "The provider has been removed from your gateway.",
	// 	});
	// };

	// const editProvider = (provider: (typeof providersList)[0]) => {
	// 	setEditingProvider(provider);
	// 	setEditDialogOpen(true);
	// };

	// const saveProvider = (updatedProvider: (typeof providersList)[0]) => {
	// 	setProvidersList((prev) =>
	// 		prev.map((p) => (p.id === updatedProvider.id ? updatedProvider : p)),
	// 	);
	// 	toast("Provider Updated", {
	// 		description: "The provider settings have been updated.",
	// 	});
	// 	setEditDialogOpen(false);
	// 	setEditingProvider(null);
	// };

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Provider</TableHead>
						<TableHead>Base URL</TableHead>
						<TableHead>Models</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Priority</TableHead>
						{/* <TableHead className="text-right">Actions</TableHead> */}
					</TableRow>
				</TableHeader>
				<TableBody>
					{providersList.map((provider) => (
						<TableRow key={provider.id}>
							<TableCell className="font-medium">{provider.name}</TableCell>
							<TableCell className="font-mono text-xs">
								{provider.baseUrl}
							</TableCell>
							<TableCell>
								{provider.models.length > 0 ? provider.models.join(", ") : "—"}
							</TableCell>
							<TableCell>
								<Badge
									variant={
										provider.status === "connected" ? "default" : "secondary"
									}
								>
									{provider.status}
								</Badge>
							</TableCell>
							<TableCell>
								<Badge
									variant="outline"
									className={
										provider.priority === "high"
											? "border-green-500 text-green-500"
											: provider.priority === "medium"
												? "border-yellow-500 text-yellow-500"
												: "border-gray-500 text-gray-500"
									}
								>
									{provider.priority}
								</Badge>
							</TableCell>
							{/* <TableCell className="text-right">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon" className="h-8 w-8">
											<MoreHorizontal className="h-4 w-4" />
											<span className="sr-only">Open menu</span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuLabel>Actions</DropdownMenuLabel>
										<DropdownMenuItem onClick={() => editProvider(provider)}>
											<Edit className="mr-2 h-4 w-4" />
											Edit Provider
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<DropdownMenuItem onSelect={(e) => e.preventDefault()}>
													<Trash className="mr-2 h-4 w-4" />
													<span className="text-destructive">
														Delete Provider
													</span>
												</DropdownMenuItem>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														Are you absolutely sure?
													</AlertDialogTitle>
													<AlertDialogDescription>
														This will permanently remove this provider.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => deleteProvider(provider.id)}
														className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
													>
														Delete
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell> */}
						</TableRow>
					))}
				</TableBody>
			</Table>

			{/* {editingProvider && (
				<EditProviderDialog
					provider={editingProvider}
					open={editDialogOpen}
					onOpenChange={setEditDialogOpen}
					onSave={saveProvider}
				/>
			)} */}
		</>
	);
}
