"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useDeleteAccount, useUpdateUser } from "@/hooks/useUser";
import { useUser } from "@/hooks/useUser";
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
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";

function formatProviderName(providerId: string): string {
	switch (providerId) {
		case "github":
			return "GitHub";
		case "google":
			return "Google";
		case "credential":
			return "Email & Password";
		default:
			return providerId.charAt(0).toUpperCase() + providerId.slice(1);
	}
}

export function AccountClient() {
	const { user } = useUser();
	const router = useRouter();

	const [name, setName] = useState(user?.name ?? "");
	const [email, setEmail] = useState(user?.email ?? "");

	useEffect(() => {
		if (user) {
			setName(user.name ?? "");
			setEmail(user.email ?? "");
		}
	}, [user]);

	const hasCredentialAccount = user?.accounts?.some(
		(a) => a.providerId === "credential",
	);
	const emailEditable = !!hasCredentialAccount;

	const socialProviders =
		user?.accounts?.filter((a) => a.providerId !== "credential") ?? [];

	const updateUserMutation = useUpdateUser();
	const deleteAccountMutation = useDeleteAccount();

	const handleUpdateUser = async () => {
		try {
			await updateUserMutation.mutateAsync({
				body: {
					name: name ?? undefined,
					email: emailEditable ? (email ?? undefined) : undefined,
				},
			});

			toast({
				title: "Success",
				description: "Your account information has been updated.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description:
					error instanceof Error ? error.message : "An error occurred",
				variant: "destructive",
			});
		}
	};

	const handleDeleteAccount = async () => {
		try {
			await deleteAccountMutation.mutateAsync({});

			toast({
				title: "Account Deleted",
				description: "Your account has been successfully deleted.",
			});

			router.refresh();
		} catch (error) {
			toast({
				title: "Error",
				description:
					error instanceof Error ? error.message : "An error occurred",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Account</h2>
				</div>
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Account Information</CardTitle>
							<CardDescription>Update your account details</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input
									id="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									disabled={!emailEditable}
								/>
								{!emailEditable && (
									<div className="flex items-center gap-2 flex-wrap">
										<p className="text-muted-foreground text-sm">
											Signed in via
										</p>
										{socialProviders.map((a) => (
											<Badge key={a.providerId} variant="secondary">
												{formatProviderName(a.providerId)}
											</Badge>
										))}
										{user?.hasPasskeys && (
											<Badge variant="secondary">Passkey</Badge>
										)}
										<p className="text-muted-foreground text-sm">
											— email cannot be changed
										</p>
									</div>
								)}
							</div>
						</CardContent>
						<CardFooter className="flex justify-between">
							<Button variant="outline">Cancel</Button>
							<Button
								onClick={handleUpdateUser}
								disabled={updateUserMutation.isPending}
							>
								{updateUserMutation.isPending ? "Saving..." : "Save Changes"}
							</Button>
						</CardFooter>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>Delete Account</CardTitle>
							<CardDescription>
								Permanently delete your account and personal data
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							<p className="text-muted-foreground text-sm">
								This action is irreversible. Your account and personal data,
								including login credentials and personal API keys, will be
								permanently deleted.
							</p>
							<p className="text-muted-foreground text-sm">
								Billing records of credits you purchased and spent are retained
								for 10 years as required by tax and accounting law. See our{" "}
								<a
									href="/legal/privacy"
									className="underline underline-offset-4 hover:text-foreground"
								>
									Privacy Policy
								</a>{" "}
								for details.
							</p>
						</CardContent>
						<CardFooter>
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
										<AlertDialogTitle>
											Are you absolutely sure?
										</AlertDialogTitle>
										<AlertDialogDescription>
											This permanently deletes your account and personal data,
											including login credentials and personal API keys. This
											action cannot be undone. Billing records of credits you
											purchased and spent are retained for 10 years as required
											by tax and accounting law.
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
						</CardFooter>
					</Card>
				</div>
			</div>
		</div>
	);
}
