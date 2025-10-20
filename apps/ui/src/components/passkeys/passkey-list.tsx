import { formatDistanceToNow } from "date-fns";
import { KeySquare, Trash2, Loader2 } from "lucide-react";

import { useAuthClient } from "@/lib/auth-client";
import { Button } from "@/lib/components/button";
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

export function PasskeyList() {
	const authClient = useAuthClient();
	const api = useApi();

	const {
		data,
		isPending: isLoading,
		error,
		refetch,
	} = authClient.useListPasskeys();

	const passkeys = data ?? [];

	const {
		mutate: deletePasskey,
		isPending: isDeleting,
		variables: deletingId,
	} = api.useMutation("delete", "/user/me/passkeys/{id}", {
		onSuccess: () => {
			toast({
				title: "Passkey deleted",
				description: "Your passkey has been removed.",
			});

			void refetch();
		},
		onError: (error: any) => {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error ? error.message : "Error deleting passkey");
			toast({
				title: errorMessage,
				variant: "destructive",
			});
		},
	});

	if (isLoading) {
		return (
			<div className="flex justify-center items-center p-8">
				<Loader2 className="h-6 w-6 animate-spin" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="text-center py-4 text-destructive">
				<p>Failed to load passkeys.</p>
			</div>
		);
	}

	if (passkeys.length === 0) {
		return (
			<div className="text-center py-4">
				<KeySquare className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
				<p className="text-muted-foreground">No passkeys found</p>
				<p className="text-sm text-muted-foreground">
					Add a passkey to enable passwordless login
				</p>
			</div>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Device</TableHead>
					<TableHead>Added</TableHead>
					<TableHead className="w-[100px]" />
				</TableRow>
			</TableHeader>
			<TableBody>
				{passkeys.map((passkey) => (
					<TableRow key={passkey.id}>
						<TableCell className="font-medium">
							{passkey.name || passkey.deviceType || "Unknown device"}
						</TableCell>
						<TableCell>
							{formatDistanceToNow(new Date(passkey.createdAt), {
								addSuffix: true,
							})}
						</TableCell>
						<TableCell>
							<Button
								variant="ghost"
								size="icon"
								disabled={
									isDeleting && deletingId?.params?.path.id === passkey.id
								}
								onClick={() =>
									deletePasskey({
										params: { path: { id: passkey.id } },
									})
								}
							>
								{isDeleting && deletingId?.params?.path.id === passkey.id ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Trash2 className="h-4 w-4" />
								)}
							</Button>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
