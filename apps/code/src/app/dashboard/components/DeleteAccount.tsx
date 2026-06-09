"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteAccount } from "@/hooks/useUser";

export default function DeleteAccount() {
	const router = useRouter();
	const deleteAccountMutation = useDeleteAccount();

	const handleDeleteAccount = async () => {
		try {
			await deleteAccountMutation.mutateAsync({});
			toast.success("Your account has been successfully deleted.");
			router.push("/");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "An error occurred");
		}
	};

	return (
		<div>
			<h2 className="mb-4 font-semibold">Delete Account</h2>
			<div className="rounded-xl border p-5 space-y-4">
				<div className="space-y-2">
					<p className="text-sm text-muted-foreground">
						This action is irreversible. Your account and personal data,
						including login credentials and personal API keys, will be
						permanently deleted.
					</p>
					<p className="text-sm text-muted-foreground">
						Billing records of credits you purchased and spent are retained for
						10 years as required by tax and accounting law. See our{" "}
						<Link
							href="/legal/privacy"
							className="underline underline-offset-4 hover:text-foreground"
						>
							Privacy Policy
						</Link>{" "}
						for details.
					</p>
				</div>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							variant="destructive"
							disabled={deleteAccountMutation.isPending}
						>
							{deleteAccountMutation.isPending
								? "Deleting..."
								: "Delete Account"}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
							<AlertDialogDescription>
								This permanently deletes your account and personal data,
								including login credentials and personal API keys. This action
								cannot be undone. Billing records of credits you purchased and
								spent are retained for 10 years as required by tax and
								accounting law.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleDeleteAccount}
								disabled={deleteAccountMutation.isPending}
								className="bg-destructive text-white hover:bg-destructive/90"
							>
								{deleteAccountMutation.isPending
									? "Deleting..."
									: "Delete Account"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}
