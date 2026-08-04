import { CopyableId } from "@/components/copyable-id";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import type { paths } from "@/lib/api/v1";

type SsoResponse =
	paths["/admin/organizations/{orgId}/sso"]["get"]["responses"]["200"]["content"]["application/json"];

function formatDateTime(dateString: string) {
	return new Date(dateString).toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function roleBadgeVariant(role: string) {
	switch (role) {
		case "owner":
			return "default" as const;
		case "admin":
			return "secondary" as const;
		default:
			return "outline" as const;
	}
}

export function SsoTab({ data }: { data: SsoResponse }) {
	const {
		ssoAutoJoinDomain,
		connections,
		scimTokens,
		roleMappings,
		defaultProjects,
		scimGroups,
	} = data;

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>SSO Connections ({connections.length})</CardTitle>
					<CardDescription>
						SAML/OIDC identity provider connections registered for this
						organization.
						{ssoAutoJoinDomain
							? ` Google auto-join is enabled for the domain "${ssoAutoJoinDomain}".`
							: " Google auto-join is not configured."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto rounded-lg border border-border/60">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Provider ID</TableHead>
									<TableHead>Domain</TableHead>
									<TableHead>Issuer</TableHead>
									<TableHead>Vendor</TableHead>
									<TableHead>Protocol</TableHead>
									<TableHead>Enforced</TableHead>
									<TableHead>Domain verified</TableHead>
									<TableHead>Created</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{connections.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={8}
											className="h-24 text-center text-muted-foreground"
										>
											No SSO connections
										</TableCell>
									</TableRow>
								) : (
									connections.map((connection) => (
										<TableRow key={connection.id}>
											<TableCell className="font-mono">
												{connection.providerId}
											</TableCell>
											<TableCell>{connection.domain}</TableCell>
											<TableCell className="max-w-[240px] truncate text-muted-foreground">
												{connection.issuer}
											</TableCell>
											<TableCell>
												<Badge variant="outline">
													{connection.providerType}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													{connection.protocol.toUpperCase()}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge
													variant={connection.enforced ? "default" : "outline"}
												>
													{connection.enforced ? "enforced" : "optional"}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge
													variant={
														connection.domainVerified ? "secondary" : "outline"
													}
												>
													{connection.domainVerified
														? "verified"
														: "unverified"}
												</Badge>
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDateTime(connection.createdAt)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Directory Sync — SCIM ({scimTokens.length})</CardTitle>
					<CardDescription>
						Bearer tokens the identity provider uses to provision users and
						groups.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto rounded-lg border border-border/60">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Token</TableHead>
									<TableHead>Linked connection</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Last used</TableHead>
									<TableHead>Created</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{scimTokens.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={5}
											className="h-24 text-center text-muted-foreground"
										>
											No SCIM tokens
										</TableCell>
									</TableRow>
								) : (
									scimTokens.map((token) => (
										<TableRow key={token.id}>
											<TableCell className="font-mono">
												{token.maskedToken}
											</TableCell>
											<TableCell className="font-mono text-muted-foreground">
												{token.ssoProviderId ?? "—"}
											</TableCell>
											<TableCell>
												<Badge
													variant={
														token.status === "active" ? "secondary" : "outline"
													}
												>
													{token.status}
												</Badge>
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{token.lastUsedAt
													? formatDateTime(token.lastUsedAt)
													: "never"}
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDateTime(token.createdAt)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Group Role Mappings ({roleMappings.length})</CardTitle>
						<CardDescription>
							IdP group names mapped to organization roles.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{roleMappings.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No role mappings — SSO members join as developers.
							</p>
						) : (
							<div className="space-y-2">
								{roleMappings.map((mapping) => (
									<div
										key={mapping.id}
										className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
									>
										<span className="text-sm font-medium">
											{mapping.groupName}
										</span>
										<Badge variant={roleBadgeVariant(mapping.role)}>
											{mapping.role}
										</Badge>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Default Projects ({defaultProjects.length})</CardTitle>
						<CardDescription>
							Projects granted to newly provisioned SSO/SCIM developers. With
							none configured, provisioning falls back to the
							organization&apos;s first project.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{defaultProjects.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No default projects configured.
							</p>
						) : (
							<div className="space-y-2">
								{defaultProjects.map((project) => (
									<div
										key={project.id}
										className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
									>
										<span className="text-sm font-medium">
											{project.projectName ?? "(deleted project)"}
										</span>
										<CopyableId id={project.projectId} />
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>SCIM Groups ({scimGroups.length})</CardTitle>
					<CardDescription>
						Groups pushed by the identity provider, with current member counts.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto rounded-lg border border-border/60">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Group</TableHead>
									<TableHead>External ID</TableHead>
									<TableHead>Members</TableHead>
									<TableHead>Created</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{scimGroups.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={4}
											className="h-24 text-center text-muted-foreground"
										>
											No SCIM groups
										</TableCell>
									</TableRow>
								) : (
									scimGroups.map((group) => (
										<TableRow key={group.id}>
											<TableCell className="font-medium">
												{group.displayName}
											</TableCell>
											<TableCell className="font-mono text-muted-foreground">
												{group.externalId ?? "—"}
											</TableCell>
											<TableCell className="tabular-nums">
												{group.memberCount}
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDateTime(group.createdAt)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
