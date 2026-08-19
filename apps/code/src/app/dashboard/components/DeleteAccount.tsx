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
import { useAccountDeletionPreview, useDeleteAccount } from "@/hooks/useUser";

interface DeletionPreviewOrganization {
	id: string;
	name: string;
	kind: "default" | "chat" | "devpass";
	plan: "free" | "pro" | "enterprise";
	devPlan: "none" | "lite" | "pro" | "max";
	chatPlan: "none" | "starter" | "plus" | "pro";
	credits: string;
	hasForfeitableCredits: boolean;
	activeSubscriptions: number;
}

function formatCredits(credits: string): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(Number(credits));
}

function titleCase(value: string) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function describeSubscription(org: DeletionPreviewOrganization) {
	switch (org.kind) {
		case "devpass":
			return `DevPass ${titleCase(org.devPlan)}`;
		case "chat":
			return `Chat ${titleCase(org.chatPlan)}`;
		default:
			return `${org.name} — ${titleCase(org.plan)} plan`;
	}
}

export default function DeleteAccount() {
	const router = useRouter();
	const deleteAccountMutation = useDeleteAccount();
	const { data: deletionPreview } = useAccountDeletionPreview();

	const previewOrganizations = deletionPreview?.organizations ?? [];
	const subscribedOrganizations = previewOrganizations.filter(
		(org) => org.activeSubscriptions > 0,
	);
	const organizationsWithCredits = previewOrganizations.filter(
		(org) => org.hasForfeitableCredits,
	);

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
						Any organization you are the last member of is closed, and its
						active subscriptions — including your DevPass plan — are cancelled
						immediately.
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
							{subscribedOrganizations.length > 0 && (
								<div className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-left text-sm">
									<p className="font-medium">
										You are the only member of these organizations, so their
										subscriptions will be cancelled immediately:
									</p>
									<ul className="text-muted-foreground mt-2 list-disc pl-4">
										{subscribedOrganizations.map((org) => (
											<li key={org.id}>{describeSubscription(org)}</li>
										))}
									</ul>
								</div>
							)}
							{organizationsWithCredits.length > 0 && (
								<div className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-left text-sm">
									<p className="font-medium">
										These organizations still hold credits, which are forfeited
										when your account is deleted:
									</p>
									<ul className="text-muted-foreground mt-2 list-disc pl-4">
										{organizationsWithCredits.map((org) => (
											<li key={org.id}>
												{org.name} — {formatCredits(org.credits)}
											</li>
										))}
									</ul>
									<p className="text-muted-foreground mt-2">
										Spend or request a refund of the balance first if you want
										to keep it.
									</p>
								</div>
							)}
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
