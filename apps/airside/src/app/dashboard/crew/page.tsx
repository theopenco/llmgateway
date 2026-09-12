"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus, Users, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useCompany } from "@/components/dashboard/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";

export default function CrewPage() {
	const api = useApi();
	const queryClient = useQueryClient();
	const { company, isLoading: companyLoading } = useCompany();
	const [email, setEmail] = useState("");

	const crewQuery = api.useQuery(
		"get",
		"/airside/companies/{id}/members",
		{
			params: { path: { id: company?.id ?? "" } },
		},
		{ enabled: !!company },
	);

	const crewQueryKey = api.queryOptions(
		"get",
		"/airside/companies/{id}/members",
		{
			params: { path: { id: company?.id ?? "" } },
		},
	).queryKey;

	const invite = api.useMutation("post", "/airside/companies/{id}/members", {
		onSuccess: async (data) => {
			await queryClient.invalidateQueries({ queryKey: crewQueryKey });
			setEmail("");
			toast.success(
				data.member
					? `${data.member.email} joined the crew and was notified by email.`
					: `Invitation sent to ${data.invite?.email}.`,
			);
		},
		onError: (error) => {
			toast.error(
				(error as { message?: string })?.message ?? "Failed to invite",
			);
		},
	});

	const removeMember = api.useMutation(
		"delete",
		"/airside/companies/{id}/members/{memberId}",
		{
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: crewQueryKey });
				toast.success("Crew member removed.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ?? "Failed to remove",
				);
			},
		},
	);

	const revokeInvite = api.useMutation(
		"delete",
		"/airside/companies/{id}/invites/{inviteId}",
		{
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: crewQueryKey });
				toast.success("Invite revoked.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ?? "Failed to revoke",
				);
			},
		},
	);

	if (companyLoading || (company && crewQuery.isLoading)) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-muted-foreground size-5 animate-spin" />
			</div>
		);
	}

	if (!company) {
		return (
			<p className="text-muted-foreground py-20 text-center text-sm">
				Register your company first —{" "}
				<Link href="/onboarding" className="text-primary hover:underline">
					start onboarding
				</Link>
				.
			</p>
		);
	}

	const data = crewQuery.data;
	const members = data?.members ?? [];
	const invites = data?.invites ?? [];
	const limit = data?.limit ?? 10;
	const isOwner = data?.viewerRole === "owner";
	const seatsUsed = members.length + invites.length;

	return (
		<div className="space-y-6" data-testid="crew-page">
			<div className="flex items-end justify-between">
				<div>
					<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Flight crew
					</p>
					<h1 className="font-display text-3xl font-black tracking-tight">
						Your crew
					</h1>
				</div>
				<p
					className="text-muted-foreground font-mono text-xs"
					data-testid="crew-seats"
				>
					{seatsUsed} / {limit} seats
				</p>
			</div>

			{isOwner ? (
				<Card>
					<CardHeader>
						<CardTitle className="font-display flex items-center gap-2">
							<Users className="text-primary size-4" /> Invite a teammate
						</CardTitle>
						<CardDescription>
							Invites are limited to your team's domains. Teammates with an
							account join instantly; anyone else joins the first time they sign
							in here with the invited address. Everyone receives an invitation
							email.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="flex max-w-md gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								invite.mutate({
									params: { path: { id: company.id } },
									body: { email },
								});
							}}
						>
							<Input
								type="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								placeholder="teammate@yourcompany.com"
								data-testid="crew-invite-email"
							/>
							<Button
								type="submit"
								className="font-semibold"
								disabled={
									!email.trim() || invite.isPending || seatsUsed >= limit
								}
								data-testid="crew-invite-submit"
							>
								{invite.isPending ? "Inviting…" : "Invite"}
							</Button>
						</form>
						{seatsUsed >= limit ? (
							<p className="text-muted-foreground mt-2 text-xs">
								Crew is full — a carrier crew is limited to {limit} members,
								pending invites included.
							</p>
						) : null}
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle className="font-display">Crew manifest</CardTitle>
					<CardDescription>
						Everyone with access to this carrier console.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table data-testid="crew-table">
						<TableHeader>
							<TableRow>
								<TableHead>Email</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Since</TableHead>
								{isOwner ? <TableHead /> : null}
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.map((member) => (
								<TableRow key={member.id}>
									<TableCell className="font-mono">{member.email}</TableCell>
									<TableCell>{member.name ?? "—"}</TableCell>
									<TableCell>
										<Badge
											variant={
												member.role === "owner" ? "default" : "secondary"
											}
										>
											{member.role}
										</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground font-mono text-xs">
										{new Date(member.createdAt).toLocaleDateString("en-US", {
											month: "short",
											day: "numeric",
										})}
									</TableCell>
									{isOwner ? (
										<TableCell className="text-right">
											{member.role !== "owner" ? (
												<Button
													size="sm"
													variant="ghost"
													disabled={removeMember.isPending}
													data-testid={`remove-member-${member.email}`}
													onClick={() =>
														removeMember.mutate({
															params: {
																path: {
																	id: company.id,
																	memberId: member.id,
																},
															},
														})
													}
												>
													<UserMinus className="size-4" />
												</Button>
											) : null}
										</TableCell>
									) : null}
								</TableRow>
							))}
							{invites.map((pendingInvite) => (
								<TableRow key={pendingInvite.id}>
									<TableCell className="font-mono">
										{pendingInvite.email}
									</TableCell>
									<TableCell className="text-muted-foreground">—</TableCell>
									<TableCell>
										<Badge variant="pending">invited</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground font-mono text-xs">
										{new Date(pendingInvite.createdAt).toLocaleDateString(
											"en-US",
											{ month: "short", day: "numeric" },
										)}
									</TableCell>
									{isOwner ? (
										<TableCell className="text-right">
											<Button
												size="sm"
												variant="ghost"
												disabled={revokeInvite.isPending}
												data-testid={`revoke-invite-${pendingInvite.email}`}
												onClick={() =>
													revokeInvite.mutate({
														params: {
															path: {
																id: company.id,
																inviteId: pendingInvite.id,
															},
														},
													})
												}
											>
												<X className="size-4" />
											</Button>
										</TableCell>
									) : null}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
