"use client";

import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";

interface ArchiveFlaggedAccountButtonProps {
	userId: string;
	email: string;
	archived: boolean;
}

export function ArchiveFlaggedAccountButton({
	userId,
	email,
	archived,
}: ArchiveFlaggedAccountButtonProps) {
	const router = useRouter();
	const $api = useApi();
	const mutation = $api.useMutation(
		"patch",
		"/admin/flagged-accounts/{userId}/archive",
		{
			meta: {
				errorMessage: `Failed to ${archived ? "restore" : "archive"} account`,
			},
			onSuccess: () => {
				toast.success(`${email} ${archived ? "restored" : "archived"}`);
				router.refresh();
			},
		},
	);
	const loading = mutation.isPending;

	const handleClick = () => {
		mutation.mutate({
			params: { path: { userId } },
			body: { archived: !archived },
		});
	};

	const Icon = archived ? ArchiveRestore : Archive;

	return (
		<Button
			variant="outline"
			size="sm"
			disabled={loading}
			onClick={handleClick}
		>
			{loading ? (
				<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
			) : (
				<Icon className="mr-1.5 h-4 w-4" />
			)}
			{archived ? "Restore" : "Archive"}
		</Button>
	);
}
