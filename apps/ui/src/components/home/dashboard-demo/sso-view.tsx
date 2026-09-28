"use client";

import { Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import {
	DEMO_PROJECTS,
	DEMO_TEAMS,
	SSO_CONNECTION,
	SSO_ROLE_MAPPINGS,
	SSO_TEAM_MAPPINGS,
} from "@/components/home/dashboard-demo-data";
import { ProjectMultiSelect } from "@/components/projects/project-multi-select";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Switch } from "@/lib/components/switch";
import { useAppConfig } from "@/lib/config";

import { READ_ONLY_MESSAGE, useDemo } from "./context";

type MappedRole = "owner" | "admin" | "project_admin" | "developer";

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	const { notify } = useDemo();
	return (
		<div className="space-y-1">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			<div className="flex items-center gap-2">
				<Input readOnly value={value} className="font-mono text-xs" />
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={() => {
						void navigator.clipboard.writeText(value);
						notify(`${label} copied`);
					}}
				>
					<Copy className="h-4 w-4" />
					<span className="sr-only">Copy {label}</span>
				</Button>
			</div>
		</div>
	);
}

export function SsoView() {
	const { apiUrl } = useAppConfig();
	const { notify, track } = useDemo();
	const [enforced, setEnforced] = useState(SSO_CONNECTION.enforced);
	const [groupName, setGroupName] = useState("");
	const [role, setRole] = useState<MappedRole>("developer");
	const [teamGroup, setTeamGroup] = useState("");
	const [teamId, setTeamId] = useState("");
	const [defaultProjects, setDefaultProjects] = useState([DEMO_PROJECTS[0].id]);
	const domains = SSO_CONNECTION.domains.join(", ");
	const providerId = SSO_CONNECTION.providerId;

	return (
		<div className="flex flex-col space-y-6 p-4 pt-6 md:p-8">
			<div>
				<h2 className="text-3xl font-bold tracking-tight">SSO</h2>
				<p className="text-muted-foreground">
					Connect Okta, Microsoft Entra ID, or any SAML 2.0 identity provider so
					members sign in with SSO, enable SCIM so users are provisioned
					automatically, or let Google Workspace users auto-join by email
					domain.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Connections</CardTitle>
					<CardDescription>
						Users whose email matches a connection&apos;s domain can sign in via
						your identity provider — or, with a Google Workspace connection,
						auto-join this organization when signing in with Google.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="space-y-3 rounded-lg border p-4">
						<div className="flex items-start justify-between gap-4">
							<div className="space-y-1.5">
								<p className="font-medium">{providerId}</p>
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="text-sm text-muted-foreground">
										Email domains:
									</span>
									{SSO_CONNECTION.domains.map((domain) => (
										<Badge key={domain} variant="secondary">
											{domain}
										</Badge>
									))}
									<Button
										variant="ghost"
										size="icon"
										className="h-6 w-6"
										onClick={() => notify(READ_ONLY_MESSAGE)}
									>
										<Pencil className="h-3.5 w-3.5" />
										<span className="sr-only">Edit email domains</span>
									</Button>
								</div>
							</div>
							<Button
								variant="outline"
								size="icon"
								onClick={() => notify(READ_ONLY_MESSAGE)}
							>
								<Trash2 className="h-4 w-4" />
								<span className="sr-only">Delete connection</span>
							</Button>
						</div>
						<ReadOnlyField
							label="SP Entity ID / Audience URI (Okta: Audience URI)"
							value={`${apiUrl}/auth/sso/saml2/sp/metadata?providerId=${providerId}`}
						/>
						<ReadOnlyField
							label="ACS URL (Okta: Single sign-on URL)"
							value={`${apiUrl}/auth/sso/saml2/sp/acs/${providerId}`}
						/>
						<div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
							<div>
								<p className="text-sm font-medium">Require SSO</p>
								<p className="text-xs text-muted-foreground">
									{enforced
										? `Password, social and passkey sign-in are blocked for ${domains}.`
										: `Password, social and passkey sign-in are allowed for ${domains}.`}
								</p>
							</div>
							<Switch
								checked={enforced}
								onCheckedChange={(checked) => {
									setEnforced(checked);
									track("sso_enforced", String(checked));
								}}
							/>
						</div>
					</div>
					<p className="text-sm text-muted-foreground">
						One connection per organization for now — remove the existing
						connection to switch providers.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Directory sync (SCIM)</CardTitle>
					<CardDescription>
						Generate a SCIM token and configure it in your identity provider
						(Okta or Microsoft Entra ID) to provision and deprovision members of
						this organization automatically.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<ReadOnlyField label="SCIM base URL" value={`${apiUrl}/scim/v2`} />
					<div className="flex items-center gap-3">
						<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
							Rotate SCIM token
						</Button>
						<Button variant="outline" onClick={() => notify(READ_ONLY_MESSAGE)}>
							Revoke
						</Button>
					</div>
					<p className="text-sm text-muted-foreground">
						A SCIM token is active for this organization (scim_k3F9qLm2•••••).
						Rotating replaces it — update your identity provider with the new
						token.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Group role mapping</CardTitle>
					<CardDescription>
						Map an IdP group (pushed via SCIM) to an organization role. Members
						receive the highest-ranked role among their groups; unmapped members
						default to Developer. Owners are never automatically demoted.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="divide-y rounded-lg border">
						{SSO_ROLE_MAPPINGS.map((mapping) => (
							<div
								key={mapping.id}
								className="flex items-center justify-between gap-4 p-3"
							>
								<div className="text-sm">
									<span className="font-medium">{mapping.groupName}</span>
									<span className="text-muted-foreground"> → </span>
									<span className="capitalize">
										{mapping.role.replace("_", " ")}
									</span>
								</div>
								<Button
									variant="outline"
									size="icon"
									onClick={() => notify(READ_ONLY_MESSAGE)}
								>
									<Trash2 className="h-4 w-4" />
									<span className="sr-only">Delete mapping</span>
								</Button>
							</div>
						))}
					</div>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							notify(READ_ONLY_MESSAGE);
						}}
						className="flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-end"
					>
						<div className="flex-1 space-y-2">
							<Label htmlFor="demo-mapping-group">IdP group name</Label>
							<Input
								id="demo-mapping-group"
								placeholder="Engineering Admins"
								value={groupName}
								onChange={(e) => setGroupName(e.target.value)}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="demo-mapping-role">Role</Label>
							<Select
								value={role}
								onValueChange={(value) => setRole(value as MappedRole)}
							>
								<SelectTrigger id="demo-mapping-role" className="sm:w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="developer">Developer</SelectItem>
									<SelectItem value="project_admin">Project admin</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
									<SelectItem value="owner">Owner</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<Button type="submit">Add mapping</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Group team mapping</CardTitle>
					<CardDescription>
						Map an IdP group (pushed via SCIM) to an organization team.
						Developers inherit that team's project, IAM, API-key, and budget
						policy. Directory sync assigns and removes synced teams
						automatically; manual team assignments are kept. If several mappings
						apply, the first group name alphabetically wins. Owners and admins
						never belong to teams.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="divide-y rounded-lg border">
						{SSO_TEAM_MAPPINGS.map((mapping) => (
							<div
								key={mapping.id}
								className="flex items-center justify-between gap-4 p-3"
							>
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<span className="font-medium">{mapping.groupName}</span>
									<span className="text-muted-foreground">→</span>
									<Badge variant="secondary">{mapping.teamName}</Badge>
								</div>
								<Button
									variant="outline"
									size="icon"
									onClick={() => notify(READ_ONLY_MESSAGE)}
								>
									<Trash2 className="h-4 w-4" />
									<span className="sr-only">Delete team mapping</span>
								</Button>
							</div>
						))}
					</div>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							notify(READ_ONLY_MESSAGE);
						}}
						className="flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-end"
					>
						<div className="flex-1 space-y-2">
							<Label htmlFor="demo-team-mapping-group">IdP group name</Label>
							<Input
								id="demo-team-mapping-group"
								placeholder="Data Science"
								value={teamGroup}
								onChange={(e) => setTeamGroup(e.target.value)}
								required
							/>
						</div>
						<div className="flex-1 space-y-2">
							<Label htmlFor="demo-team-mapping-team">Team</Label>
							<Select value={teamId} onValueChange={setTeamId}>
								<SelectTrigger id="demo-team-mapping-team">
									<SelectValue placeholder="Select a team" />
								</SelectTrigger>
								<SelectContent>
									{DEMO_TEAMS.map((team) => (
										<SelectItem key={team.id} value={team.id}>
											{team.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button type="submit" disabled={!teamId}>
							Save mapping
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Default project access</CardTitle>
					<CardDescription>
						Projects that members provisioned via SSO/SCIM/Google auto-join get
						access to when they first sign in. Only affects the{" "}
						<strong>developer</strong> role — owners and admins can always
						access every project. Existing members are unchanged; this applies
						to newly provisioned users.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<ProjectMultiSelect
						orgProjects={DEMO_PROJECTS.map((project) => ({
							id: project.id,
							name: project.name,
						}))}
						selected={defaultProjects}
						onChange={setDefaultProjects}
					/>
					<Button
						disabled={
							defaultProjects.length === 1 &&
							defaultProjects[0] === DEMO_PROJECTS[0].id
						}
						onClick={() => notify(READ_ONLY_MESSAGE)}
					>
						Save
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
