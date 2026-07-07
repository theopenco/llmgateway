"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, HelpCircle, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
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
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Switch } from "@/lib/components/switch";
import { Textarea } from "@/lib/components/textarea";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type React from "react";

function copy(value: string, label: string) {
	void navigator.clipboard.writeText(value);
	toast({ title: `${label} copied to clipboard` });
}

// Suggested Connection ID per provider — a short, stable slug used to build the
// SP/SCIM URLs. Admins can override it.
function defaultConnectionId(
	providerType: "okta" | "entra" | "generic",
): string {
	return providerType === "entra"
		? "entra"
		: providerType === "generic"
			? "saml"
			: "okta";
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<div className="space-y-1">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			<div className="flex items-center gap-2">
				<Input readOnly value={value} className="font-mono text-xs" />
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={() => copy(value, label)}
				>
					<Copy className="h-4 w-4" />
					<span className="sr-only">Copy {label}</span>
				</Button>
			</div>
		</div>
	);
}

export function SsoClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const queryClient = useQueryClient();

	const isEnterprise = selectedOrganization?.plan === "enterprise";

	const [providerType, setProviderType] = useState<
		"okta" | "entra" | "generic"
	>("okta");
	const [providerId, setProviderId] = useState(defaultConnectionId("okta"));
	// Track whether the admin has hand-edited the Connection ID so switching the
	// provider dropdown keeps the suggested id in sync until they override it.
	const [providerIdEdited, setProviderIdEdited] = useState(false);
	const [domain, setDomain] = useState("");
	const [entryPoint, setEntryPoint] = useState("");
	const [cert, setCert] = useState("");
	const [generatedToken, setGeneratedToken] = useState<string | null>(null);
	const [groupName, setGroupName] = useState("");
	const [role, setRole] = useState<"owner" | "admin" | "developer">(
		"developer",
	);

	const providersQuery = api.useQuery(
		"get",
		"/sso/providers",
		{ params: { query: { organizationId } } },
		{ enabled: !!organizationId && isEnterprise },
	);

	const scimQuery = api.useQuery(
		"get",
		"/sso/scim",
		{ params: { query: { organizationId } } },
		{ enabled: !!organizationId && isEnterprise },
	);

	const mappingsQuery = api.useQuery(
		"get",
		"/sso/role-mappings",
		{ params: { query: { organizationId } } },
		{ enabled: !!organizationId && isEnterprise },
	);

	const registerMutation = api.useMutation("post", "/sso/providers");
	const deleteMutation = api.useMutation(
		"delete",
		"/sso/providers/{providerId}",
	);
	const updateProvider = api.useMutation(
		"patch",
		"/sso/providers/{providerId}",
	);
	const generateScim = api.useMutation("post", "/sso/scim");
	const revokeScim = api.useMutation("delete", "/sso/scim");
	const createMapping = api.useMutation("post", "/sso/role-mappings");
	const deleteMapping = api.useMutation("delete", "/sso/role-mappings/{id}");

	function invalidateProviders() {
		void queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/sso/providers", {
				params: { query: { organizationId } },
			}).queryKey,
		});
	}

	function invalidateScim() {
		void queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/sso/scim", {
				params: { query: { organizationId } },
			}).queryKey,
		});
	}

	function invalidateMappings() {
		void queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/sso/role-mappings", {
				params: { query: { organizationId } },
			}).queryKey,
		});
	}

	async function handleToggleEnforced(providerId: string, enforced: boolean) {
		try {
			await updateProvider.mutateAsync({
				params: { path: { providerId } },
				body: { organizationId, enforced },
			});
			toast({
				title: enforced
					? "SSO is now required for this domain"
					: "SSO enforcement disabled",
			});
			invalidateProviders();
		} catch {
			toast({
				title: "Failed to update enforcement",
				variant: "destructive",
			});
		}
	}

	async function handleCreateMapping(e: React.FormEvent) {
		e.preventDefault();
		try {
			await createMapping.mutateAsync({
				body: { organizationId, groupName: groupName.trim(), role },
			});
			toast({ title: "Role mapping created" });
			setGroupName("");
			setRole("developer");
			invalidateMappings();
		} catch (error) {
			toast({
				title:
					error instanceof Error ? error.message : "Failed to create mapping",
				variant: "destructive",
			});
		}
	}

	async function handleDeleteMapping(id: string) {
		try {
			await deleteMapping.mutateAsync({
				params: { path: { id }, query: { organizationId } },
			});
			toast({ title: "Role mapping deleted" });
			invalidateMappings();
		} catch {
			toast({ title: "Failed to delete mapping", variant: "destructive" });
		}
	}

	async function handleRegister(e: React.FormEvent) {
		e.preventDefault();
		try {
			await registerMutation.mutateAsync({
				body: {
					organizationId,
					providerId: providerId.trim(),
					providerType,
					domain: domain.trim(),
					entryPoint: entryPoint.trim(),
					cert: cert.trim(),
				},
			});
			toast({ title: "SSO connection created" });
			setProviderType("okta");
			setProviderId(defaultConnectionId("okta"));
			setProviderIdEdited(false);
			setDomain("");
			setEntryPoint("");
			setCert("");
			invalidateProviders();
		} catch (error) {
			toast({
				title:
					error instanceof Error
						? error.message
						: "Failed to create connection",
				variant: "destructive",
			});
		}
	}

	async function handleDelete(id: string) {
		try {
			await deleteMutation.mutateAsync({
				params: {
					path: { providerId: id },
					query: { organizationId },
				},
			});
			toast({ title: "SSO connection deleted" });
			invalidateProviders();
		} catch {
			toast({ title: "Failed to delete connection", variant: "destructive" });
		}
	}

	async function handleGenerateScim() {
		try {
			const data = await generateScim.mutateAsync({ body: { organizationId } });
			setGeneratedToken(data.token);
			invalidateScim();
		} catch {
			toast({ title: "Failed to generate SCIM token", variant: "destructive" });
		}
	}

	async function handleRevokeScim() {
		try {
			await revokeScim.mutateAsync({
				params: { query: { organizationId } },
			});
			toast({ title: "SCIM token revoked" });
			invalidateScim();
		} catch {
			toast({ title: "Failed to revoke SCIM token", variant: "destructive" });
		}
	}

	if (selectedOrganization && !isEnterprise) {
		return (
			<div className="flex flex-col space-y-4 p-4 pt-6 md:p-8">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Building2 className="h-5 w-5" />
							Single Sign-On &amp; SCIM
						</CardTitle>
						<CardDescription>
							SAML SSO and SCIM directory provisioning are available on the
							Enterprise plan. Contact us at{" "}
							<a
								href="mailto:contact@llmgateway.io"
								className="text-primary underline underline-offset-4"
							>
								contact@llmgateway.io
							</a>{" "}
							to enable them.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		);
	}

	const providers = providersQuery.data?.providers ?? [];
	const scim = scimQuery.data;
	const mappings = mappingsQuery.data?.mappings ?? [];

	return (
		<div className="flex flex-col space-y-6 p-4 pt-6 md:p-8">
			<div>
				<h2 className="text-3xl font-bold tracking-tight">SSO &amp; SCIM</h2>
				<p className="text-muted-foreground">
					Connect Okta, Microsoft Entra ID, or any SAML 2.0 identity provider so
					members sign in with SSO, and enable SCIM so users are provisioned
					automatically.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>SAML connections</CardTitle>
					<CardDescription>
						Users whose email matches a connection&apos;s domain can sign in via
						your identity provider.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{providers.length > 0 && (
						<div className="space-y-4">
							{providers.map((provider) => (
								<div
									key={provider.id}
									className="space-y-3 rounded-lg border p-4"
								>
									<div className="flex items-start justify-between gap-4">
										<div>
											<p className="font-medium">{provider.providerId}</p>
											<p className="text-sm text-muted-foreground">
												Domain: {provider.domain}
											</p>
										</div>
										<Button
											variant="outline"
											size="icon"
											onClick={() => handleDelete(provider.providerId)}
											disabled={deleteMutation.isPending}
										>
											<Trash2 className="h-4 w-4" />
											<span className="sr-only">Delete connection</span>
										</Button>
									</div>
									<ReadOnlyField
										label="SP Entity ID / Audience URI (Entra: Identifier)"
										value={provider.metadataUrl}
									/>
									<ReadOnlyField
										label="ACS URL (Okta: Single sign-on URL · Entra: Reply URL)"
										value={provider.acsUrl}
									/>
									<div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
										<div>
											<p className="text-sm font-medium">Require SSO</p>
											<p className="text-xs text-muted-foreground">
												Block password, social and passkey sign-in for{" "}
												{provider.domain}.
											</p>
										</div>
										<Switch
											checked={provider.enforced}
											disabled={updateProvider.isPending}
											onCheckedChange={(checked) =>
												handleToggleEnforced(provider.providerId, checked)
											}
										/>
									</div>
								</div>
							))}
						</div>
					)}

					<form onSubmit={handleRegister} className="space-y-4 border-t pt-6">
						<p className="text-sm font-medium">Add a connection</p>
						<div className="space-y-2">
							<Label htmlFor="sso-type">Identity provider</Label>
							<Select
								value={providerType}
								onValueChange={(value) => {
									const next = value as "okta" | "entra" | "generic";
									setProviderType(next);
									if (!providerIdEdited) {
										setProviderId(defaultConnectionId(next));
									}
								}}
							>
								<SelectTrigger id="sso-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="okta">Okta</SelectItem>
									<SelectItem value="entra">Microsoft Entra ID</SelectItem>
									<SelectItem value="generic">Other (SAML 2.0)</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<div className="flex items-center gap-1.5">
									<Label htmlFor="sso-provider-id">Connection name</Label>
									<Popover>
										<PopoverTrigger asChild>
											<button
												type="button"
												className="text-muted-foreground hover:text-foreground"
												aria-label="What is the connection name?"
											>
												<HelpCircle className="h-3.5 w-3.5" />
											</button>
										</PopoverTrigger>
										<PopoverContent side="top" className="w-80 text-sm">
											<p className="font-medium">Connection name (ID)</p>
											<p className="mt-1 text-muted-foreground">
												A short internal identifier for this SSO connection —
												lowercase letters, numbers, and hyphens only. It becomes
												part of the SP Entity ID and ACS URLs you paste into
												your IdP, so keep it stable and don&apos;t change it
												after setup. Example: <code>okta</code> or{" "}
												<code>acme-entra</code>.
											</p>
										</PopoverContent>
									</Popover>
								</div>
								<Input
									id="sso-provider-id"
									placeholder="e.g. okta or acme-entra"
									value={providerId}
									onChange={(e) => {
										setProviderId(e.target.value);
										setProviderIdEdited(true);
									}}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="sso-domain">Email domain</Label>
								<Input
									id="sso-domain"
									placeholder="acme.com"
									value={domain}
									onChange={(e) => setDomain(e.target.value)}
									required
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="sso-entrypoint">
								Identity Provider Single Sign-On URL
							</Label>
							<Input
								id="sso-entrypoint"
								placeholder="https://acme.okta.com/app/.../sso/saml"
								value={entryPoint}
								onChange={(e) => setEntryPoint(e.target.value)}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="sso-cert">X.509 signing certificate</Label>
							<Textarea
								id="sso-cert"
								placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
								value={cert}
								onChange={(e) => setCert(e.target.value)}
								className="font-mono text-xs"
								rows={5}
								required
							/>
						</div>
						<Button type="submit" disabled={registerMutation.isPending}>
							{registerMutation.isPending ? "Creating..." : "Create connection"}
						</Button>
					</form>
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
					{scim && <ReadOnlyField label="SCIM base URL" value={scim.baseUrl} />}
					<div className="flex items-center gap-3">
						<Button
							onClick={handleGenerateScim}
							disabled={generateScim.isPending}
						>
							{scim?.configured ? "Rotate SCIM token" : "Generate SCIM token"}
						</Button>
						{scim?.configured && (
							<Button
								variant="outline"
								onClick={handleRevokeScim}
								disabled={revokeScim.isPending}
							>
								Revoke
							</Button>
						)}
					</div>
					{scim?.configured && (
						<p className="text-sm text-muted-foreground">
							A SCIM token is active for this organization
							{scim.maskedToken ? ` (${scim.maskedToken})` : ""}. Rotating
							replaces it — update your identity provider with the new token.
						</p>
					)}
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
					{mappings.length > 0 && (
						<div className="divide-y rounded-lg border">
							{mappings.map((mapping) => (
								<div
									key={mapping.id}
									className="flex items-center justify-between gap-4 p-3"
								>
									<div className="text-sm">
										<span className="font-medium">{mapping.groupName}</span>
										<span className="text-muted-foreground"> → </span>
										<span className="capitalize">{mapping.role}</span>
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={() => handleDeleteMapping(mapping.id)}
										disabled={deleteMapping.isPending}
									>
										<Trash2 className="h-4 w-4" />
										<span className="sr-only">Delete mapping</span>
									</Button>
								</div>
							))}
						</div>
					)}

					<form
						onSubmit={handleCreateMapping}
						className="flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-end"
					>
						<div className="flex-1 space-y-2">
							<Label htmlFor="mapping-group">IdP group name</Label>
							<Input
								id="mapping-group"
								placeholder="Engineering Admins"
								value={groupName}
								onChange={(e) => setGroupName(e.target.value)}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="mapping-role">Role</Label>
							<Select
								value={role}
								onValueChange={(value) =>
									setRole(value as "owner" | "admin" | "developer")
								}
							>
								<SelectTrigger id="mapping-role" className="sm:w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="developer">Developer</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
									<SelectItem value="owner">Owner</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<Button type="submit" disabled={createMapping.isPending}>
							Add mapping
						</Button>
					</form>
				</CardContent>
			</Card>

			<Dialog
				open={!!generatedToken}
				onOpenChange={(open) => {
					if (!open) {
						setGeneratedToken(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>SCIM token created</DialogTitle>
						<DialogDescription>
							Copy this token into your identity provider now — for security,
							you won&apos;t be able to see it again.
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-2">
						<Input
							readOnly
							value={generatedToken ?? ""}
							className="font-mono text-xs"
						/>
						<Button
							variant="outline"
							size="icon"
							onClick={() =>
								generatedToken && copy(generatedToken, "SCIM token")
							}
						>
							<Copy className="h-4 w-4" />
							<span className="sr-only">Copy SCIM token</span>
						</Button>
					</div>
					<DialogFooter>
						<Button onClick={() => setGeneratedToken(null)}>Done</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
