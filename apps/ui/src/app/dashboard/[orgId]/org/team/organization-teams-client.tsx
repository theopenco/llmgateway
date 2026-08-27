"use client";

import { Layers3, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
	useCreateOrganizationTeam,
	useOrganizationTeams,
} from "@/hooks/useOrganizationTeams";
import { Badge } from "@/lib/components/badge";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { toast } from "@/lib/components/use-toast";

import { TeamTabs } from "./team-tabs";

import type { Route } from "next";

export function OrganizationTeamsClient({
	organizationId,
	teamUrl,
	isEnterprise,
}: {
	organizationId: string;
	teamUrl: string;
	isEnterprise: boolean;
}) {
	const { data, isLoading, isError, refetch } =
		useOrganizationTeams(organizationId);
	const createTeam = useCreateOrganizationTeam(organizationId);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");

	const handleCreate = async () => {
		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}
		await createTeam.mutateAsync({
			params: { path: { organizationId } },
			body: { name: trimmed },
		});
		setName("");
		setOpen(false);
		toast({ title: `${trimmed} created` });
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Team</h2>
						<p className="text-muted-foreground">
							Group developers under shared project, IAM, and budget ceilings.
						</p>
					</div>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button disabled={!isEnterprise}>
								<Plus className="mr-2 h-4 w-4" />
								Create team
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Create organization team</DialogTitle>
								<DialogDescription>
									Start with an empty policy, then add projects, IAM rules,
									budgets, and developers.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-2 py-4">
								<Label htmlFor="team-name">Team name</Label>
								<Input
									id="team-name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="Platform engineering"
									maxLength={100}
								/>
							</div>
							<DialogFooter>
								<Button variant="outline" onClick={() => setOpen(false)}>
									Cancel
								</Button>
								<Button
									onClick={handleCreate}
									disabled={!name.trim() || createTeam.isPending}
								>
									{createTeam.isPending ? "Creating…" : "Create team"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>

				<TeamTabs active="teams" teamUrl={teamUrl} />

				{!isEnterprise && (
					<div className="border-border bg-muted/30 flex items-start gap-3 rounded-xl border p-4">
						<ShieldCheck className="text-muted-foreground mt-0.5 h-5 w-5" />
						<div>
							<p className="font-medium">Existing policies remain enforced</p>
							<p className="text-muted-foreground text-sm">
								Enterprise access is required to create teams or change policy.
								You can still review teams, unassign members, and delete empty
								teams.
							</p>
						</div>
					</div>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Organization teams</CardTitle>
						<CardDescription>
							A developer can belong to one team. Team policy is enforced before
							personal and API-key restrictions.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<p className="text-muted-foreground py-8 text-center text-sm">
								Loading teams…
							</p>
						) : isError ? (
							<div className="flex flex-col items-center gap-3 py-10 text-center">
								<p className="font-medium">Teams could not be loaded</p>
								<p className="text-muted-foreground text-sm">
									Check your connection and try again.
								</p>
								<Button variant="outline" onClick={() => void refetch()}>
									Try again
								</Button>
							</div>
						) : !data?.teams.length ? (
							<div className="flex flex-col items-center py-12 text-center">
								<div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
									<Layers3 className="text-muted-foreground h-6 w-6" />
								</div>
								<p className="font-medium">No organization teams yet</p>
								<p className="text-muted-foreground mt-1 max-w-md text-sm">
									Create one to manage shared developer access without
									duplicating policy across every member and API key.
								</p>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Members</TableHead>
										<TableHead>Projects</TableHead>
										<TableHead>IAM</TableHead>
										<TableHead className="text-right">Manage</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.teams.map((team) => (
										<TableRow key={team.id}>
											<TableCell className="font-medium">
												<span className="flex items-center gap-2">
													{team.name}
													{team.isDefault && (
														<Badge variant="secondary">Default</Badge>
													)}
												</span>
											</TableCell>
											<TableCell>{team.members.length}</TableCell>
											<TableCell>
												{team.projects.length ? (
													<div className="flex flex-wrap gap-1">
														{team.projects.slice(0, 3).map((project) => (
															<Badge key={project.id} variant="outline">
																{project.name}
															</Badge>
														))}
														{team.projects.length > 3 && (
															<Badge variant="secondary">
																+{team.projects.length - 3}
															</Badge>
														)}
													</div>
												) : (
													<Badge variant="destructive">No access</Badge>
												)}
											</TableCell>
											<TableCell>{team.iamRules.length} rules</TableCell>
											<TableCell className="text-right">
												<Button asChild variant="outline" size="sm">
													<Link href={`${teamUrl}s/${team.id}` as Route}>
														Open
													</Link>
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
