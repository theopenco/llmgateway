"use client";

import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface ArchiveFlaggedAccountButtonProps {
	userId: string;
	email: string;
	archived: boolean;
	onChange: (
		userId: string,
		archived: boolean,
	) => Promise<{ success: boolean; error?: string }>;
}

export function ArchiveFlaggedAccountButton({
	userId,
	email,
	archived,
	onChange,
}: ArchiveFlaggedAccountButtonProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleClick = async () => {
		setLoading(true);
		try {
			const result = await onChange(userId, !archived);
			if (result.success) {
				toast.success(`${email} ${archived ? "restored" : "archived"}`);
				router.refresh();
				return;
			}

			toast.error(
				result.error ?? `Failed to ${archived ? "restore" : "archive"} account`,
			);
		} catch {
			toast.error(`Failed to ${archived ? "restore" : "archive"} account`);
		} finally {
			setLoading(false);
		}
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
