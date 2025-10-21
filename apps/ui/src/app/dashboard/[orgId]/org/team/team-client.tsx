"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	useTeamMembers,
	useAddTeamMember,
	useUpdateTeamMember,
	useRemoveTeamMember,
} from "@/hooks/useTeam";
import { Alert, AlertDescription } from "@/lib/components/alert";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";

export function TeamClient() {
	const params = useParams();
	const config = useAppConfig();
	const organizationId = params.orgId as string;
	const { selectedOrganization } = useDashboardNavigation();

	const isProPlan = selectedOrganization?.plan === "pro";
	const isRestricted = config.hosted && !isProPlan;

	const { data, isLoading } = useTeamMembers(organizationId);
	const addMemberMutation = useAddTeamMember(organizationId);
	const updateMemberMutation = useUpdateTeamMember(organizationId);
	const removeMemberMutation = useRemoveTeamMember(organizationId);

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"owner" | "admin" | "developer">(
		"developer",
	);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

	const handleAddMember = async () => {
		if (!email) {
			toast({
				title: "Error",
				description: "Please enter an email address",
				variant: "destructive",
			});
			return;
		}

		try {
			await addMemberMutation.mutateAsync({
				params: {
					path: {
						organizationId,
					},
				},
				body: { email, role },
			});
			toast({
				title: "Success",
				description: "Team member added successfully",
			});
			setEmail("");
			setRole("developer");
			setIsAddDialogOpen(false);
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error ? error.message : "Failed to add member");
			toast({
				title: "Error",
				description: errorMessage,
				variant: "destructive",
			});
		}
	};

	const handleUpdateRole = async (
		memberId: string,
		newRole: "owner" | "admin" | "developer",
	) => {
		try {
			await updateMemberMutation.mutateAsync({
				params: {
					path: {
						organizationId,
						memberId,
					},
				},
				body: {
					role: newRole,
				},
			});
			toast({
				title: "Success",
				description: "Role updated successfully",
			});
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error ? error.message : "Failed to update role");
			toast({
				title: "Error",
				description: errorMessage,
				variant: "destructive",
			});
		}
	};

	const handleRemoveMember = async (memberId: string, memberName: string) => {
		const confirmed = window.confirm(
			`Are you sure you want to remove ${memberName} from the team?`,
		);

		if (!confirmed) {
			return;
		}

		try {
			await removeMemberMutation.mutateAsync({
				params: {
					path: {
						organizationId,
						memberId,
					},
				},
			});
			toast({
				title: "Success",
				description: "Team member removed successfully",
			});
		} catch (error: any) {
			const errorMessage =
				error?.error?.message ||
				error?.message ||
				(error instanceof Error ? error.message : "Failed to remove member");
			toast({
				title: "Error",
				description: errorMessage,
				variant: "destructive",
			});
		}
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Team</h2>
					<Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
						<DialogTrigger asChild>
							<Button disabled={isRestricted}>Add Member</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add Team Member</DialogTitle>
								<DialogDescription>
									Add a new member to your organization by entering their email
									address.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="email">Email</Label>
									<Input
										id="email"
										type="email"
										placeholder="user@example.com"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="role">Role</Label>
									<Select
										value={role}
										onValueChange={(value) =>
											setRole(value as "owner" | "admin" | "developer")
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Select a role" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="developer">Developer</SelectItem>
											<SelectItem value="admin">Admin</SelectItem>
											<SelectItem value="owner">Owner</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<Alert>
									<AlertDescription>
										3 seats are included; any additional members will incur a
										cost of{" "}
										<span className="inline font-semibold">$10/seat/month</span>
										The charge will be prorated based on your billing cycle.
									</AlertDescription>
								</Alert>
							</div>
							<DialogFooter>
								<Button
									variant="outline"
									onClick={() => setIsAddDialogOpen(false)}
								>
									Cancel
								</Button>
								<Button
									onClick={handleAddMember}
									disabled={addMemberMutation.isPending}
								>
									{addMemberMutation.isPending ? "Adding..." : "Add Member"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>

				{isRestricted && (
					<Alert>
						<AlertDescription className="flex items-center justify-between gap-2">
							<span>
								Team management is only available on the Pro plan. Upgrade to
								invite and manage team members.
							</span>
							<UpgradeToProDialog>
								<Button size="sm" variant="outline">
									Upgrade to Pro
								</Button>
							</UpgradeToProDialog>
						</AlertDescription>
					</Alert>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Team Members</CardTitle>
						<CardDescription>
							Manage your organization's team members and their roles
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div>Loading...</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>Role</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data?.members.map((member) => (
										<TableRow key={member.id}>
											<TableCell>{member.user.name || "—"}</TableCell>
											<TableCell>{member.user.email}</TableCell>
											<TableCell>
												<Select
													value={member.role}
													onValueChange={(value) =>
														handleUpdateRole(
															member.id,
															value as "owner" | "admin" | "developer",
														)
													}
													disabled={
														isRestricted || updateMemberMutation.isPending
													}
												>
													<SelectTrigger className="w-[130px]">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="developer">Developer</SelectItem>
														<SelectItem value="admin">Admin</SelectItem>
														<SelectItem value="owner">Owner</SelectItem>
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="destructive"
													size="sm"
													onClick={() =>
														handleRemoveMember(
															member.id,
															member.user.name || member.user.email,
														)
													}
													disabled={
														isRestricted || removeMemberMutation.isPending
													}
												>
													Remove
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Role Permissions</CardTitle>
						<CardDescription>
							Understanding what each role can do
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<h4 className="font-semibold">Owner</h4>
							<p className="text-muted-foreground text-sm">
								Full access to all features including team management, billing,
								and organization settings.
							</p>
						</div>
						<div>
							<h4 className="font-semibold">Admin</h4>
							<p className="text-muted-foreground text-sm">
								Can manage team members, projects, and API keys, but cannot
								access billing settings or modify owners.
							</p>
						</div>
						<div>
							<h4 className="font-semibold">Developer</h4>
							<p className="text-muted-foreground text-sm">
								Can view and use projects and API keys, but cannot modify team
								or organization settings.
							</p>
						</div>
						<div>
							<h4 className="font-semibold">Restricted Access</h4>
							<p className="text-muted-foreground text-sm">
								If you want a user to just access the API but not the dashboard
								or settings, just add an API key for them, where you can also
								set specific permissions.
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
