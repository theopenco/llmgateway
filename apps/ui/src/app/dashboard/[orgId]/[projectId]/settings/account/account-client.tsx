"use client";

import { useState } from "react";

import { useDeleteAccount, useUpdateUser } from "@/hooks/useUser";
import { useUser } from "@/hooks/useUser";
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

export function AccountClient() {
	const { user } = useUser();

	const [name, setName] = useState(user?.name || "");
	const [email, setEmail] = useState(user?.email || "");

	const updateUserMutation = useUpdateUser();
	const deleteAccountMutation = useDeleteAccount();

	const handleUpdateUser = async () => {
		try {
			await updateUserMutation.mutateAsync({
				body: {
					name: name || undefined,
					email: email || undefined,
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
		const confirmed = window.confirm(
			"Are you sure you want to delete your account? This action cannot be undone.",
		);

		if (!confirmed) {
			return;
		}

		try {
			await deleteAccountMutation.mutateAsync({});

			toast({
				title: "Account Deleted",
				description: "Your account has been successfully deleted.",
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
								/>
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
								Permanently delete your account and all associated data
							</CardDescription>
						</CardHeader>
						<CardContent>
							<p className="text-muted-foreground text-sm">
								This action is irreversible. All your data, including API keys,
								usage history, and provider connections will be permanently
								deleted.
							</p>
						</CardContent>
						<CardFooter>
							<Button
								variant="destructive"
								onClick={handleDeleteAccount}
								disabled={deleteAccountMutation.isPending}
							>
								{deleteAccountMutation.isPending
									? "Deleting..."
									: "Delete Account"}
							</Button>
						</CardFooter>
					</Card>
				</div>
			</div>
		</div>
	);
}
