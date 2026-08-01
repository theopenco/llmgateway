"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Building2,
	Copy,
	HelpCircle,
	Loader2,
	Pencil,
	Trash2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ProjectMultiSelect } from "@/components/projects/project-multi-select";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Alert, AlertDescription } from "@/lib/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/lib/components/alert-dialog";
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
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import type React from "react";

async function copy(value: string, label: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast({ title: `${label} copied to clipboard` });
	} catch {
		// Clipboard writes reject in insecure contexts or when permission is denied
		// — don't claim success the user can't see.
		toast({
			title: `Failed to copy ${label}`,
			description: "Copy it manually instead.",
			variant: "destructive",
		});
	}
}

// Turn an org name into a URL-safe a-z0-9 slug used as the SSO connection id.
// Mirrors the backend `^[a-z0-9-]+$` constraint so the value is safe to embed in
// the SP Entity ID / ACS URLs and works with case-insensitive IdPs.
function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// The SP metadata / ACS URLs the admin pastes into their IdP. Kept in sync with
// `samlEndpoints` in apps/api/src/routes/sso.ts so the live preview matches what
// the backend registers.
function samlEndpoints(apiUrl: string, providerId: string) {
	return {
		metadataUrl: `${apiUrl}/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
		acsUrl: `${apiUrl}/auth/sso/saml2/sp/acs/${providerId}`,
	};
}

// Field labels for the two SP URLs, annotated with only the selected IdP's own
// naming so admins aren't shown terms for a vendor they aren't using.
function endpointLabels(
	providerType: "" | "okta" | "entra" | "generic" | "google",
) {
	switch (providerType) {
		case "okta":
			return {
				entityId: "SP Entity ID / Audience URI (Okta: Audience URI)",
				acs: "ACS URL (Okta: Single sign-on URL)",
			};
		case "entra":
			return {
				entityId: "SP Entity ID / Audience URI (Entra: Identifier)",
				acs: "ACS URL (Entra: Reply URL)",
			};
		default:
			return {
				entityId: "SP Entity ID / Audience URI",
				acs: "ACS URL",
			};
	}
}

// The `domain` column is a comma-separated list of email domains; split it for
// display (badges, human-readable sentences).
function splitDomains(domain: string): string[] {
	return domain
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean);
}

function formatDomains(domain: string): string {
	return splitDomains(domain).join(", ");
}

// openapi-fetch rejects with the parsed error body ({ message }), not an Error
// instance — surface the server's message (e.g. the 409 duplicate-domain
// conflict) instead of a generic fallback.
function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}
	return fallback;
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
					onClick={() => void copy(value, label)}
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
	const { apiUrl } = useAppConfig();

	const isEnterprise = selectedOrganization?.plan === "enterprise";

	const [providerType, setProviderType] = useState<
		"" | "okta" | "entra" | "generic" | "google"
	>("");
	const [providerId, setProviderId] = useState("");
	// Track whether the admin has hand-edited the slug so we keep suggesting one
	// derived from the org name until they type their own.
	const [providerIdEdited, setProviderIdEdited] = useState(false);
	const [domain, setDomain] = useState("");
	const [entryPoint, setEntryPoint] = useState("");
	const [cert, setCert] = useState("");
	const [enforced, setEnforced] = useState(false);
	const [generatedToken, setGeneratedToken] = useState<string | null>(null);
	// Edit buffer for an existing connection's email domains. `null` = dialog
	// closed; otherwise holds the connection slug plus the comma-separated list
	// being edited.
	const [domainEdit, setDomainEdit] = useState<{
		providerId: string;
		value: string;
	} | null>(null);
	// Edit buffer for the Google Workspace auto-join domain. `null` = dialog
	// closed. Kept separate from `domainEdit` — Google auto-join is a single
	// domain stored on the organization, not a SAML connection.
	const [googleEdit, setGoogleEdit] = useState<string | null>(null);
	const [groupName, setGroupName] = useState("");
	const [role, setRole] = useState<"owner" | "admin" | "developer">(
		"developer",
	);
	// Local edit buffer for the default-projects checklist. `null` = untouched, so
	// the displayed selection derives from the server value (or the fallback
	// project). Reset to `null` after a successful save to re-sync with the server.
	const [projectDraft, setProjectDraft] = useState<string[] | null>(null);
	// Confirmation for destructive actions (delete connection, revoke/rotate SCIM
	// token) — each has organization-wide blast radius, so a single misclick
	// shouldn't fire immediately.
	const [confirmAction, setConfirmAction] = useState<{
		title: string;
		description: string;
		actionLabel: string;
		run: () => void | Promise<void>;
	} | null>(null);

	// Slug the admin pastes into the IdP (part of the SP URLs). Suggested as the
	// recommended `<org-slug>-<provider>` format until the admin overrides it; must
	// stay a-z0-9 and globally unique.
	const orgSlug = slugify(selectedOrganization?.name ?? "");
	const isSamlType = providerType !== "" && providerType !== "google";
	const providerSuffix = providerType === "generic" ? "saml" : providerType;
	const suggestedSlug =
		orgSlug && isSamlType ? `${orgSlug}-${providerSuffix}` : "";
	const effectiveSlug = (providerIdEdited ? providerId : suggestedSlug).trim();
	const preview = samlEndpoints(apiUrl, effectiveSlug);
	const providerLabel =
		providerType === "entra"
			? "Microsoft Entra ID"
			: providerType === "okta"
				? "Okta"
				: "your identity provider";

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

	const defaultProjectsQuery = api.useQuery(
		"get",
		"/sso/default-projects",
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
	const saveDefaultProjects = api.useMutation("put", "/sso/default-projects");
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			// The auto-join domain lives on the organization, which the dashboard
			// reads from the /orgs list query.
			void queryClient.refetchQueries({
				queryKey: api.queryOptions("get", "/orgs").queryKey,
			});
		},
	});

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

	function invalidateDefaultProjects() {
		void queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/sso/default-projects", {
				params: { query: { organizationId } },
			}).queryKey,
		});
	}

	// When nothing is configured yet, the checklist pre-selects the org's fallback
	// (oldest) project — matching what provisioning would grant — so saving as-is
	// is a no-op change rather than a surprise.
	const defaultProjectsData = defaultProjectsQuery.data;
	const savedProjectIds = defaultProjectsData?.selectedProjectIds ?? [];
	const initialProjectIds =
		savedProjectIds.length > 0
			? savedProjectIds
			: defaultProjectsData?.fallbackProjectId
				? [defaultProjectsData.fallbackProjectId]
				: [];
	const selectedProjectIds = projectDraft ?? initialProjectIds;
	const projectSelectionDirty = projectDraft !== null;

	async function handleSaveDefaultProjects() {
		try {
			await saveDefaultProjects.mutateAsync({
				body: { organizationId, projectIds: selectedProjectIds },
			});
			toast({ title: "Default project access saved" });
			setProjectDraft(null);
			invalidateDefaultProjects();
		} catch (error) {
			toast({
				title:
					error instanceof Error
						? error.message
						: "Failed to save default project access",
				variant: "destructive",
			});
		}
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

	async function handleSaveDomains(e: React.FormEvent) {
		e.preventDefault();
		if (!domainEdit) {
			return;
		}
		try {
			await updateProvider.mutateAsync({
				params: { path: { providerId: domainEdit.providerId } },
				body: { organizationId, domain: domainEdit.value.trim() },
			});
			toast({ title: "Email domains updated" });
			setDomainEdit(null);
			invalidateProviders();
		} catch (error) {
			toast({
				title:
					error instanceof Error ? error.message : "Failed to update domains",
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
		if (!providerType) {
			return;
		}
		if (providerType === "google") {
			await handleSaveGoogleDomain(domain);
			return;
		}
		try {
			await registerMutation.mutateAsync({
				body: {
					organizationId,
					providerId: effectiveSlug,
					providerType,
					domain: domain.trim(),
					entryPoint: entryPoint.trim(),
					cert: cert.trim(),
					enforced,
				},
			});
			toast({ title: "SSO connection created" });
			setProviderType("");
			setProviderId("");
			setProviderIdEdited(false);
			setDomain("");
			setEntryPoint("");
			setCert("");
			setEnforced(true);
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

	async function handleSaveGoogleDomain(value: string) {
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: organizationId } },
				body: { ssoAutoJoinDomain: value.trim() || null },
			});
			toast({
				title: value.trim()
					? "Google Workspace auto-join enabled"
					: "Google Workspace auto-join disabled",
			});
			setProviderType("");
			setDomain("");
			setGoogleEdit(null);
		} catch (error) {
			toast({
				title: errorMessage(error, "Failed to save Google Workspace auto-join"),
				variant: "destructive",
			});
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

	// Wait for the org (and thus its plan) to load before deciding what to show,
	// otherwise the full management UI briefly flashes for non-enterprise orgs
	// before the upsell card replaces it.
	if (!selectedOrganization) {
		return (
			<div className="flex items-center justify-center p-8">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!isEnterprise) {
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

	// Google Workspace auto-join is stored on the organization, not as a SAML
	// connection. It rides on the "Sign in with Google" button, so a SAML
	// connection with Require SSO on the same domain blocks it entirely.
	const googleDomain = selectedOrganization.ssoAutoJoinDomain ?? null;
	const enforcedSamlDomains = new Set(
		providers
			.filter((provider) => provider.enforced)
			.flatMap((provider) =>
				splitDomains(provider.domain).map((d) => d.toLowerCase()),
			),
	);
	const googleDomainBlocked =
		!!googleDomain && enforcedSamlDomains.has(googleDomain.toLowerCase());
	// Google Workspace can't SCIM-provision custom apps, and group role mapping
	// rides on SCIM-pushed groups — with a Google-only setup both are inert, so
	// their cards render disabled with an explanation instead of dead controls.
	const googleOnly = !!googleDomain && providers.length === 0;
	// One connection per organization for now — SAML or Google Workspace.
	const hasConnection = providers.length > 0 || !!googleDomain;

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
					{providers.length > 0 && (
						<div className="space-y-4">
							{providers.map((provider) => (
								<div
									key={provider.id}
									className="space-y-3 rounded-lg border p-4"
								>
									<div className="flex items-start justify-between gap-4">
										<div className="space-y-1.5">
											<p className="font-medium">{provider.providerId}</p>
											<div className="flex flex-wrap items-center gap-1.5">
												<span className="text-sm text-muted-foreground">
													Email domains:
												</span>
												{splitDomains(provider.domain).map((d) => (
													<Badge key={d} variant="secondary">
														{d}
													</Badge>
												))}
												<Button
													variant="ghost"
													size="icon"
													className="h-6 w-6"
													onClick={() =>
														setDomainEdit({
															providerId: provider.providerId,
															value: formatDomains(provider.domain),
														})
													}
												>
													<Pencil className="h-3.5 w-3.5" />
													<span className="sr-only">Edit email domains</span>
												</Button>
											</div>
										</div>
										<Button
											variant="outline"
											size="icon"
											onClick={() =>
												setConfirmAction({
													title: "Delete SSO connection?",
													description: `This removes the SAML connection for ${formatDomains(provider.domain)}. If Require SSO is on, users on those domains won't be able to sign in until you add a new connection.`,
													actionLabel: "Delete connection",
													run: () => handleDelete(provider.providerId),
												})
											}
											disabled={deleteMutation.isPending}
										>
											<Trash2 className="h-4 w-4" />
											<span className="sr-only">Delete connection</span>
										</Button>
									</div>
									<ReadOnlyField
										label={endpointLabels(provider.providerType).entityId}
										value={provider.metadataUrl}
									/>
									<ReadOnlyField
										label={endpointLabels(provider.providerType).acs}
										value={provider.acsUrl}
									/>
									<div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
										<div>
											<p className="text-sm font-medium">Require SSO</p>
											<p className="text-xs text-muted-foreground">
												{provider.enforced
													? `Password, social and passkey sign-in are blocked for ${formatDomains(provider.domain)}.`
													: `Password, social and passkey sign-in are allowed for ${formatDomains(provider.domain)}.`}
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

					{googleDomain && (
						<div className="space-y-3 rounded-lg border p-4">
							<div className="flex items-start justify-between gap-4">
								<div className="space-y-1.5">
									<p className="font-medium">Google Workspace</p>
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="text-sm text-muted-foreground">
											Auto-join domain:
										</span>
										<Badge variant="secondary">{googleDomain}</Badge>
										<Button
											variant="ghost"
											size="icon"
											className="h-6 w-6"
											onClick={() => setGoogleEdit(googleDomain)}
										>
											<Pencil className="h-3.5 w-3.5" />
											<span className="sr-only">Edit auto-join domain</span>
										</Button>
									</div>
								</div>
								<Button
									variant="outline"
									size="icon"
									onClick={() =>
										setConfirmAction({
											title: "Remove Google Workspace auto-join?",
											description: `New sign-ins with Google accounts on ${googleDomain} will no longer join this organization automatically. Existing members are unaffected.`,
											actionLabel: "Remove auto-join",
											run: () => handleSaveGoogleDomain(""),
										})
									}
									disabled={updateOrganization.isPending}
								>
									<Trash2 className="h-4 w-4" />
									<span className="sr-only">Remove auto-join</span>
								</Button>
							</div>
							<p className="text-sm text-muted-foreground">
								Anyone signing in with a Google account on this domain is added
								to this organization as a <strong>developer</strong> and
								notified by email. No IdP setup needed — it uses the standard
								“Sign in with Google” button.
							</p>
							{googleDomainBlocked && (
								<Alert variant="destructive">
									<AlertDescription>
										A SAML connection with <strong>Require SSO</strong> covers{" "}
										<strong>{googleDomain}</strong>, which blocks Google sign-in
										for that domain — auto-join will never trigger. Disable
										Require SSO or remove this auto-join domain.
									</AlertDescription>
								</Alert>
							)}
						</div>
					)}

					{hasConnection && (
						<p className="text-sm text-muted-foreground">
							One connection per organization for now — remove the existing
							connection to switch providers.
						</p>
					)}

					{!hasConnection && (
						<form onSubmit={handleRegister} className="space-y-6 border-t pt-6">
							<div className="space-y-4">
								<p className="text-sm font-medium">Add a connection</p>
								<div className="space-y-2">
									<Label htmlFor="sso-type">Identity provider</Label>
									<Select
										value={providerType}
										onValueChange={(value) =>
											setProviderType(
												value as "okta" | "entra" | "generic" | "google",
											)
										}
									>
										<SelectTrigger id="sso-type">
											<SelectValue placeholder="Select an identity provider" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="okta">Okta</SelectItem>
											<SelectItem value="entra">Microsoft Entra ID</SelectItem>
											<SelectItem value="generic">Other (SAML 2.0)</SelectItem>
											<SelectItem value="google">Google Workspace</SelectItem>
										</SelectContent>
									</Select>
									{providerType === "google" && (
										<p className="text-sm text-muted-foreground">
											Google Workspace doesn&apos;t need a SAML app or SCIM:
											members sign in with the standard “Sign in with Google”
											button, and anyone on your email domain joins this
											organization automatically as a <strong>developer</strong>
											.
										</p>
									)}
								</div>
								{providerType === "google" && (
									<div className="space-y-2">
										<Label htmlFor="google-domain">Email domain</Label>
										<Input
											id="google-domain"
											placeholder="acme.com"
											value={domain}
											onChange={(e) => setDomain(e.target.value)}
											required
										/>
										<p className="text-sm text-muted-foreground">
											A single corporate domain — consumer email domains
											(gmail.com, outlook.com, …) are not allowed, and a domain
											can only be claimed by one organization.
										</p>
									</div>
								)}
								{isSamlType && (
									<div className="grid gap-4 md:grid-cols-2">
										<div className="space-y-2">
											<div className="flex items-center gap-1.5">
												<Label htmlFor="sso-provider-id">Connection slug</Label>
												<Popover>
													<PopoverTrigger asChild>
														<button
															type="button"
															className="text-muted-foreground hover:text-foreground"
															aria-label="What is the connection slug?"
														>
															<HelpCircle className="h-3.5 w-3.5" />
														</button>
													</PopoverTrigger>
													<PopoverContent side="top" className="w-80 text-sm">
														<p className="font-medium">Connection slug</p>
														<p className="mt-1 text-muted-foreground">
															A short identifier for this connection — lowercase
															letters, numbers, and hyphens only, unique across
															all LLM Gateway organizations. It becomes part of
															the SP Entity ID and ACS URLs you paste into your
															IdP, so keep it stable and don&apos;t change it
															after setup. We recommend the format{" "}
															<code>
																&lt;your-org-slug&gt;-&lt;provider&gt;
															</code>
															, e.g. <code>acme-okta</code> or{" "}
															<code>acme-entra</code>.
														</p>
													</PopoverContent>
												</Popover>
											</div>
											<Input
												id="sso-provider-id"
												placeholder="acme-entra"
												value={providerIdEdited ? providerId : suggestedSlug}
												onChange={(e) => {
													setProviderId(e.target.value);
													setProviderIdEdited(true);
												}}
												required
											/>
										</div>
										<div className="space-y-2">
											<div className="flex items-center gap-1.5">
												<Label htmlFor="sso-domain">Email domains</Label>
												<Popover>
													<PopoverTrigger asChild>
														<button
															type="button"
															className="text-muted-foreground hover:text-foreground"
															aria-label="Which email domains should I list?"
														>
															<HelpCircle className="h-3.5 w-3.5" />
														</button>
													</PopoverTrigger>
													<PopoverContent side="top" className="w-80 text-sm">
														<p className="font-medium">Email domains</p>
														<p className="mt-1 text-muted-foreground">
															Comma-separated list of domains that route to this
															connection. It must include{" "}
															<strong>
																every domain your IdP may send as the
																user&apos;s email
															</strong>{" "}
															— on Entra that&apos;s the <code>mail</code>{" "}
															attribute&apos;s domain, which can differ from the
															sign-in (UPN) domain. If they differ, list both,
															e.g. <code>acme.com, acme-corp.com</code>;
															otherwise logins bounce with an &quot;account not
															linked&quot; error.
														</p>
													</PopoverContent>
												</Popover>
											</div>
											<Input
												id="sso-domain"
												placeholder="acme.com, acme-corp.com"
												value={domain}
												onChange={(e) => setDomain(e.target.value)}
												required
											/>
										</div>
									</div>
								)}
							</div>

							{providerType === "google" && (
								<Button type="submit" disabled={updateOrganization.isPending}>
									{updateOrganization.isPending
										? "Enabling..."
										: "Enable auto-join"}
								</Button>
							)}

							{isSamlType && effectiveSlug && (
								<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
									<div>
										<p className="text-sm font-medium">
											1. Configure these in {providerLabel}
										</p>
										<p className="text-xs text-muted-foreground">
											Create the SAML application in your IdP using these two
											URLs. They&apos;re derived from your connection slug — no
											need to type them anywhere but your IdP.
										</p>
									</div>
									<ReadOnlyField
										label={endpointLabels(providerType).entityId}
										value={preview.metadataUrl}
									/>
									<ReadOnlyField
										label={endpointLabels(providerType).acs}
										value={preview.acsUrl}
									/>
								</div>
							)}

							{isSamlType && (
								<div className="space-y-4">
									<p className="text-sm font-medium">
										2. Paste back what {providerLabel} gives you
									</p>
									<div className="space-y-2">
										<Label htmlFor="sso-entrypoint">
											Identity Provider Single Sign-On URL
										</Label>
										<Input
											id="sso-entrypoint"
											placeholder={
												providerType === "entra"
													? "https://login.microsoftonline.com/<uuid>/saml2"
													: "https://acme.okta.com/app/.../sso/saml"
											}
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
									<div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
										<div>
											<p className="text-sm font-medium">Require SSO</p>
											<p className="text-xs text-muted-foreground">
												Block password, social and passkey sign-in for
												{domain.trim() ? ` ${domain.trim()}` : " this domain"}.
											</p>
										</div>
										<Switch checked={enforced} onCheckedChange={setEnforced} />
									</div>
									<Button type="submit" disabled={registerMutation.isPending}>
										{registerMutation.isPending
											? "Creating..."
											: "Create connection"}
									</Button>
								</div>
							)}
						</form>
					)}
				</CardContent>
			</Card>

			<Card className={googleOnly ? "opacity-60" : undefined}>
				<CardHeader>
					<CardTitle>Directory sync (SCIM)</CardTitle>
					<CardDescription>
						{googleOnly
							? "Not available for the Google Workspace connection — Google Workspace doesn't support SCIM provisioning for custom apps. Members are provisioned just-in-time when they sign in with Google; offboard them on the Team page."
							: "Generate a SCIM token and configure it in your identity provider (Okta or Microsoft Entra ID) to provision and deprovision members of this organization automatically."}
					</CardDescription>
				</CardHeader>
				{!googleOnly && (
					<CardContent className="space-y-4">
						{scim && (
							<ReadOnlyField label="SCIM base URL" value={scim.baseUrl} />
						)}
						<div className="flex items-center gap-3">
							<Button
								onClick={() => {
									if (scim?.configured) {
										setConfirmAction({
											title: "Rotate SCIM token?",
											description:
												"The current token stops working immediately. Directory provisioning will fail until you update your identity provider with the new token.",
											actionLabel: "Rotate token",
											run: handleGenerateScim,
										});
									} else {
										void handleGenerateScim();
									}
								}}
								disabled={generateScim.isPending}
							>
								{scim?.configured ? "Rotate SCIM token" : "Generate SCIM token"}
							</Button>
							{scim?.configured && (
								<Button
									variant="outline"
									onClick={() =>
										setConfirmAction({
											title: "Revoke SCIM token?",
											description:
												"Directory provisioning stops working immediately. You'll need to generate a new token and update your identity provider to resume it.",
											actionLabel: "Revoke token",
											run: handleRevokeScim,
										})
									}
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
				)}
			</Card>

			<Card className={googleOnly ? "opacity-60" : undefined}>
				<CardHeader>
					<CardTitle>Group role mapping</CardTitle>
					<CardDescription>
						{googleOnly
							? "Not available for the Google Workspace connection — role mappings rely on groups pushed via SCIM. Auto-joined members get the developer role; change roles on the Team page."
							: "Map an IdP group (pushed via SCIM) to an organization role. Members receive the highest-ranked role among their groups; unmapped members default to Developer. Owners are never automatically demoted."}
					</CardDescription>
				</CardHeader>
				{!googleOnly && (
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
				)}
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
					{defaultProjectsData && defaultProjectsData.projects.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							This organization has no projects yet. Create a project first,
							then choose which ones SSO members get by default.
						</p>
					) : (
						<>
							<ProjectMultiSelect
								orgProjects={defaultProjectsData?.projects ?? []}
								selected={selectedProjectIds}
								onChange={setProjectDraft}
							/>
							{selectedProjectIds.length === 0 && (
								<p className="text-sm text-muted-foreground">
									With no projects selected, newly provisioned SSO members
									(developers) start with no project access and must be granted
									access manually.
								</p>
							)}
							<Button
								onClick={handleSaveDefaultProjects}
								disabled={
									saveDefaultProjects.isPending || !projectSelectionDirty
								}
							>
								{saveDefaultProjects.isPending ? "Saving..." : "Save"}
							</Button>
						</>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={!!domainEdit}
				onOpenChange={(open) => {
					if (!open) {
						setDomainEdit(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-[500px]">
					<form onSubmit={handleSaveDomains} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Edit email domains</DialogTitle>
							<DialogDescription>
								Comma-separated list of email domains for this connection. It
								must include every domain your identity provider may send as a
								user&apos;s email — e.g. on Entra both the sign-in (UPN) domain
								and the <code>mail</code> attribute&apos;s domain if they
								differ. Existing sign-ins are unaffected.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-2">
							<Label htmlFor="sso-edit-domains">Email domains</Label>
							<Input
								id="sso-edit-domains"
								placeholder="acme.com, acme-corp.com"
								value={domainEdit?.value ?? ""}
								onChange={(e) =>
									setDomainEdit((prev) =>
										prev ? { ...prev, value: e.target.value } : prev,
									)
								}
								required
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDomainEdit(null)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={updateProvider.isPending}>
								{updateProvider.isPending ? "Saving..." : "Save"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={googleEdit !== null}
				onOpenChange={(open) => {
					if (!open) {
						setGoogleEdit(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-[500px]">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (googleEdit !== null) {
								void handleSaveGoogleDomain(googleEdit);
							}
						}}
						className="space-y-4"
					>
						<DialogHeader>
							<DialogTitle>Edit auto-join domain</DialogTitle>
							<DialogDescription>
								Users signing in with a Google account on this domain auto-join
								the organization as a developer. Existing members are unaffected
								by changes.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-2">
							<Label htmlFor="google-edit-domain">Email domain</Label>
							<Input
								id="google-edit-domain"
								placeholder="acme.com"
								value={googleEdit ?? ""}
								onChange={(e) => setGoogleEdit(e.target.value)}
								required
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setGoogleEdit(null)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={updateOrganization.isPending}>
								{updateOrganization.isPending ? "Saving..." : "Save"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

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
							onClick={() => {
								if (generatedToken) {
									void copy(generatedToken, "SCIM token");
								}
							}}
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

			<AlertDialog
				open={!!confirmAction}
				onOpenChange={(open) => {
					if (!open) {
						setConfirmAction(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmAction?.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								void confirmAction?.run();
								setConfirmAction(null);
							}}
						>
							{confirmAction?.actionLabel}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
