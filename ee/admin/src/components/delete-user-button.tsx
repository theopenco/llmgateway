"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface DeleteUserButtonProps {
	userId: string;
	userEmail: string;
	onDelete: (userId: string) => Promise<{ success: boolean }>;
}

export function DeleteUserButton({
	userId,
	userEmail,
	onDelete,
}: DeleteUserButtonProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const handleDelete = async () => {
		if (
			!confirm(
				`Are you sure you want to delete user "${userEmail}"? This action cannot be undone.`,
			)
		) {
			return;
		}

		setLoading(true);
		const result = await onDelete(userId);
		setLoading(false);

		if (result.success) {
			router.refresh();
		}
	};

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={handleDelete}
			disabled={loading}
			className="text-destructive hover:text-destructive"
		>
			{loading ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<Trash2 className="h-4 w-4" />
			)}
		</Button>
	);
}
