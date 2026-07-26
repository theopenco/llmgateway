"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { getProviderIcon } from "@llmgateway/shared";
import {
	ReorderableItem,
	ReorderableList,
	SearchableSelect,
} from "@llmgateway/shared/components";

import type {
	ProviderCredential,
	ProviderCredentialCatalogEntry,
} from "@/lib/admin-provider-credentials";

type Variant = "default" | "enterprise" | "plans";

const VARIANT_LABELS: Record<Variant, string> = {
	default: "All organizations",
	enterprise: "Enterprise plans",
	plans: "DevPass / Chat plans",
};

/**
 * Env var each audience corresponds to, so an admin migrating a deployment can
 * match a credential to the variable it replaces.
 */
const VARIANT_ENV_SUFFIXES: Record<Variant, string | null> = {
	default: null,
	enterprise: "__ENTERPRISE",
	plans: "__PLANS",
};

const VARIANT_ORDER: Variant[] = ["default", "enterprise", "plans"];

/**
 * Sentinel for "no region pinned". Radix Select cannot hold an empty string as
 * an item value, and the API models an unpinned credential as a null region.
 */
const ANY_REGION = "__any__";

type VariantCounts = Record<Variant, number>;

const NO_CREDENTIALS: VariantCounts = {
	default: 0,
	enterprise: 0,
	plans: 0,
};

function totalOf(counts: VariantCounts): number {
	return counts.default + counts.enterprise + counts.plans;
}

interface MutationResult {
	success: boolean;
	error?: string;
}

interface ProviderCredentialsManagerProps {
	credentials: ProviderCredential[];
	catalog: ProviderCredentialCatalogEntry[];
	onCreate: (body: {
		provider: string;
		token: string;
		comment?: string;
		variant?: Variant;
		region?: string;
		config?: Record<string, string>;
		skipValidation?: boolean;
	}) => Promise<MutationResult>;
	onUpdate: (
		id: string,
		body: {
			token?: string;
			comment?: string | null;
			variant?: Variant;
			region?: string | null;
			status?: "active" | "inactive";
			config?: Record<string, string>;
			skipValidation?: boolean;
		},
	) => Promise<MutationResult>;
	onDelete: (id: string) => Promise<MutationResult>;
	onReorder: (
		provider: string,
		credentialIds: string[],
	) => Promise<MutationResult>;
}

function ProviderIcon({ provider }: { provider: string }) {
	const Icon = getProviderIcon(provider);
	return Icon ? <Icon className="h-4 w-4 shrink-0" /> : null;
}

function ProviderCell({ provider }: { provider: string }) {
	return (
		<div className="flex items-center gap-2">
			<ProviderIcon provider={provider} />
			<span className="font-medium">{provider}</span>
		</div>
	);
}

export function ProviderCredentialsManager({
	credentials,
	catalog,
	onCreate,
	onUpdate,
	onDelete,
	onReorder,
}: ProviderCredentialsManagerProps) {
	const router = useRouter();
	const [editing, setEditing] = useState<ProviderCredential | null>(null);
	const [creating, setCreating] = useState(false);
	const [deleting, setDeleting] = useState<ProviderCredential | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const catalogById = useMemo(
		() => new Map(catalog.map((entry) => [entry.id, entry])),
		[catalog],
	);

	// Shown against each provider in the picker so an admin adding a key can see
	// at a glance which providers are already covered and which are still bare,
	// broken down by audience to pair with each one's env-var count.
	const credentialCounts = useMemo(() => {
		const counts = new Map<string, VariantCounts>();
		for (const credential of credentials) {
			const current = counts.get(credential.provider) ?? {
				default: 0,
				enterprise: 0,
				plans: 0,
			};
			const variant = credential.variant as Variant;
			counts.set(credential.provider, {
				...current,
				[variant]: (current[variant] ?? 0) + 1,
			});
		}
		return counts;
	}, [credentials]);

	const regionsInUse = useMemo(
		() =>
			credentials.map((credential) => ({
				provider: credential.provider,
				region: credential.region,
			})),
		[credentials],
	);

	// Rows arrive grouped by provider (the API orders by provider, then position),
	// so each run becomes its own reorderable tbody.
	const serverOrder = useMemo(() => {
		const groups = new Map<string, string[]>();
		for (const credential of credentials) {
			groups.set(credential.provider, [
				...(groups.get(credential.provider) ?? []),
				credential.id,
			]);
		}
		return groups;
	}, [credentials]);

	const credentialById = useMemo(
		() => new Map(credentials.map((credential) => [credential.id, credential])),
		[credentials],
	);

	// There is no query cache here — mutations are server actions followed by
	// router.refresh() — so the dragged order lives in local state until the
	// refreshed props arrive, which is what keeps the rows from snapping back.
	const [order, setOrder] = useState(serverOrder);
	const [savingProvider, setSavingProvider] = useState<string | null>(null);
	const preDragOrder = useRef<Map<string, string[]> | null>(null);

	useEffect(() => {
		if (savingProvider || preDragOrder.current) {
			return;
		}
		setOrder(serverOrder);
	}, [serverOrder, savingProvider]);

	function applyReorder(provider: string, ids: string[]) {
		if (!preDragOrder.current) {
			preDragOrder.current = new Map(order);
		}
		setOrder((current) => new Map(current).set(provider, ids));
	}

	async function commitReorder(provider: string, ids: string[]) {
		const snapshot = preDragOrder.current;
		preDragOrder.current = null;
		if (!snapshot) {
			return;
		}

		setSavingProvider(provider);
		const result = await onReorder(provider, ids);
		if (!result.success) {
			setOrder(snapshot);
			toast.error(result.error ?? "Failed to save credential order");
			setSavingProvider(null);
			return;
		}
		router.refresh();
		setSavingProvider(null);
	}

	async function confirmDelete() {
		if (!deleting) {
			return;
		}
		setDeleteLoading(true);
		setDeleteError(null);
		const result = await onDelete(deleting.id);
		setDeleteLoading(false);
		if (!result.success) {
			setDeleteError(result.error ?? "Failed to delete credential");
			return;
		}
		setDeleting(null);
		router.refresh();
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<Button onClick={() => setCreating(true)}>
					<Plus className="mr-1 h-4 w-4" />
					Add credential
				</Button>
			</div>

			<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-10">
								<span className="sr-only">Order</span>
							</TableHead>
							<TableHead>Provider</TableHead>
							<TableHead>Key</TableHead>
							<TableHead>Note</TableHead>
							<TableHead>Applies to</TableHead>
							<TableHead>Region</TableHead>
							<TableHead>Settings</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					{credentials.length === 0 ? (
						<TableBody>
							<TableRow>
								<TableCell
									colSpan={9}
									className="py-10 text-center text-muted-foreground"
								>
									No managed credentials yet. Providers fall back to their{" "}
									<code>LLM_*</code> environment variables until one is added.
								</TableCell>
							</TableRow>
						</TableBody>
					) : (
						// One tbody per provider: several are valid inside a table and
						// stack seamlessly, and it makes dragging a row into another
						// provider's group structurally impossible.
						Array.from(order.entries()).map(([provider, ids]) => (
							<ReorderableList
								key={provider}
								as="tbody"
								ids={ids}
								disabled={savingProvider === provider}
								onReorder={(next) => applyReorder(provider, next)}
								onCommit={(next) => void commitReorder(provider, next)}
							>
								{ids.map((id: string, index: number) => {
									const credential = credentialById.get(id);
									if (!credential) {
										return null;
									}
									const configEntries = Object.entries(credential.config ?? {});
									return (
										<ReorderableItem
											key={credential.id}
											id={credential.id}
											as="tr"
											itemLabel={`${credential.provider} credential ${credential.maskedToken}`}
											className="border-b bg-card transition-colors hover:bg-muted/50"
										>
											{(handle) => (
												<>
													<TableCell className="w-10">
														<div className="flex items-center gap-1">
															{handle}
															<span className="text-xs tabular-nums text-muted-foreground">
																{index + 1}
															</span>
														</div>
													</TableCell>
													<TableCell>
														<ProviderCell provider={credential.provider} />
													</TableCell>
													<TableCell className="font-mono text-xs">
														<div>{credential.maskedToken}</div>
														{credential.tokenHash ? (
															<div
																className="text-[11px] text-muted-foreground"
																title={`Matches usedApiKeyHash on logs served by this credential: ${credential.tokenHash}`}
															>
																{credential.tokenHash.slice(0, 12)}
															</div>
														) : null}
													</TableCell>
													<TableCell className="max-w-[260px] text-sm text-muted-foreground">
														{credential.comment || "—"}
													</TableCell>
													<TableCell className="text-sm">
														{VARIANT_LABELS[credential.variant as Variant] ??
															credential.variant}
													</TableCell>
													<TableCell className="text-sm">
														{credential.region || "Any"}
													</TableCell>
													<TableCell>
														{configEntries.length === 0 ? (
															<span className="text-sm text-muted-foreground">
																—
															</span>
														) : (
															<div className="flex flex-wrap gap-1">
																{configEntries.map(([key, value]) => (
																	<Badge
																		key={key}
																		variant="secondary"
																		className="font-mono text-[11px]"
																		title={`${key}: ${value}`}
																	>
																		{key}
																	</Badge>
																))}
															</div>
														)}
													</TableCell>
													<TableCell>
														<Badge
															variant={
																credential.status === "active"
																	? "default"
																	: "secondary"
															}
														>
															{credential.status}
														</Badge>
													</TableCell>
													<TableCell className="text-right">
														<div className="flex justify-end gap-1">
															<Button
																variant="ghost"
																size="sm"
																aria-label={`Edit ${credential.provider} credential ${credential.maskedToken}`}
																onClick={() => setEditing(credential)}
															>
																<Pencil className="h-4 w-4" />
															</Button>
															<Button
																variant="ghost"
																size="sm"
																aria-label={`Remove ${credential.provider} credential ${credential.maskedToken}`}
																onClick={() => {
																	setDeleteError(null);
																	setDeleting(credential);
																}}
															>
																<Trash2 className="h-4 w-4" />
															</Button>
														</div>
													</TableCell>
												</>
											)}
										</ReorderableItem>
									);
								})}
							</ReorderableList>
						))
					)}
				</Table>
			</div>

			{creating ? (
				<CredentialDialog
					catalog={catalog}
					credentialCounts={credentialCounts}
					regionsInUse={regionsInUse}
					onClose={() => setCreating(false)}
					onSubmit={async (values) => {
						const result = await onCreate({
							provider: values.provider,
							token: values.token,
							comment: values.comment || undefined,
							variant: values.variant,
							region: values.region || undefined,
							config: values.config,
							skipValidation: values.skipValidation,
						});
						if (result.success) {
							setCreating(false);
							router.refresh();
						}
						return result;
					}}
				/>
			) : null}

			{editing ? (
				<CredentialDialog
					catalog={catalog}
					credential={editing}
					catalogEntry={catalogById.get(editing.provider)}
					credentialCounts={credentialCounts}
					regionsInUse={regionsInUse}
					onClose={() => setEditing(null)}
					onSubmit={async (values) => {
						const result = await onUpdate(editing.id, {
							...(values.token ? { token: values.token } : {}),
							comment: values.comment || null,
							variant: values.variant,
							region: values.region || null,
							status: values.status,
							config: values.config,
							skipValidation: values.skipValidation,
						});
						if (result.success) {
							setEditing(null);
							router.refresh();
						}
						return result;
					}}
				/>
			) : null}

			<Dialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleting(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove credential</DialogTitle>
						<DialogDescription>
							{deleting
								? `Requests routed to ${deleting.provider} will use the remaining managed credentials, or its LLM_* environment variables if this was the last one.`
								: null}
						</DialogDescription>
					</DialogHeader>
					{deleteError ? (
						<p className="text-sm text-destructive">{deleteError}</p>
					) : null}
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleting(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={confirmDelete}
							disabled={deleteLoading}
						>
							{deleteLoading ? (
								<Loader2 className="mr-1 h-4 w-4 animate-spin" />
							) : null}
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

interface CredentialFormValues {
	provider: string;
	token: string;
	comment: string;
	variant: Variant;
	region: string;
	status: "active" | "inactive";
	config: Record<string, string>;
	skipValidation: boolean;
}

function CredentialDialog({
	catalog,
	credential,
	catalogEntry,
	credentialCounts,
	regionsInUse,
	onClose,
	onSubmit,
}: {
	catalog: ProviderCredentialCatalogEntry[];
	credential?: ProviderCredential;
	catalogEntry?: ProviderCredentialCatalogEntry;
	/** Credentials already stored per provider and audience, keyed by provider id. */
	credentialCounts: Map<string, VariantCounts>;
	/** Provider/region pairs already claimed, for annotating the region options. */
	regionsInUse: { provider: string; region: string | null }[];
	onClose: () => void;
	onSubmit: (values: CredentialFormValues) => Promise<MutationResult>;
}) {
	const isEdit = credential !== undefined;
	const [provider, setProvider] = useState(
		credential?.provider ?? catalog[0]?.id ?? "",
	);
	const [token, setToken] = useState("");
	const [comment, setComment] = useState(credential?.comment ?? "");
	const [variant, setVariant] = useState<Variant>(
		(credential?.variant as Variant) ?? "default",
	);
	const [region, setRegion] = useState(credential?.region ?? "");
	const [status, setStatus] = useState<"active" | "inactive">(
		credential?.status === "inactive" ? "inactive" : "active",
	);
	const [config, setConfig] = useState<Record<string, string>>(
		credential?.config ?? {},
	);
	const [skipValidation, setSkipValidation] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedEntry =
		catalogEntry ?? catalog.find((entry) => entry.id === provider);
	const isRegionScoped = (selectedEntry?.regions.length ?? 0) > 0;

	const providerOptions = useMemo(
		() =>
			catalog.map((entry) => {
				const count = totalOf(credentialCounts.get(entry.id) ?? NO_CREDENTIALS);
				return {
					value: entry.id,
					label: entry.name,
					// Searchable by provider id too, so "vertex" finds it whichever
					// name the admin remembers.
					keywords: entry.id,
					icon: <ProviderIcon provider={entry.id} />,
					annotation:
						count > 0 ? (
							<Badge
								variant="secondary"
								className="text-[11px]"
								title={`${count} credential${count === 1 ? "" : "s"} already configured`}
							>
								{count}
							</Badge>
						) : null,
				};
			}),
		[catalog, credentialCounts],
	);

	// Regions already claimed for this provider, so an admin can see which are
	// covered before pinning another credential to one.
	const regionUsage = useMemo(() => {
		const usage = new Map<string, number>();
		for (const entry of regionsInUse) {
			if (entry.provider === provider && entry.region) {
				usage.set(entry.region, (usage.get(entry.region) ?? 0) + 1);
			}
		}
		return usage;
	}, [regionsInUse, provider]);

	async function handleSubmit() {
		setLoading(true);
		setError(null);
		const result = await onSubmit({
			provider,
			token,
			comment,
			variant,
			region,
			status,
			config,
			skipValidation,
		});
		setLoading(false);
		if (!result.success) {
			setError(result.error ?? "Something went wrong");
		}
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isEdit ? "Edit credential" : "Add credential"}
					</DialogTitle>
					<DialogDescription>
						Managed credentials serve credits-mode traffic and replace the
						provider&apos;s <code>LLM_*</code> environment variables. Add as
						many per provider as you need.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="provider">Provider</Label>
						<SearchableSelect
							id="provider"
							value={provider}
							disabled={isEdit}
							placeholder="Select a provider"
							searchPlaceholder="Search providers..."
							emptyMessage="No providers found."
							aria-label="Provider"
							onValueChange={(next) => {
								setProvider(next);
								setConfig({});
								// Regions are per-provider; carrying one over would be
								// rejected by the server.
								setRegion("");
							}}
							options={providerOptions}
						/>
						{selectedEntry ? (
							<div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
								<p className="text-xs font-medium">
									{selectedEntry.name} coverage today
								</p>
								<dl className="flex flex-col gap-1 text-xs text-muted-foreground">
									{VARIANT_ORDER.map((audience) => {
										const stored =
											credentialCounts.get(selectedEntry.id) ?? NO_CREDENTIALS;
										const envCount = selectedEntry.apiKeyEnvCounts[audience];
										return (
											<div
												key={audience}
												className="flex items-baseline justify-between gap-3"
											>
												<dt className="truncate">
													{VARIANT_LABELS[audience]}
													{VARIANT_ENV_SUFFIXES[audience] ? (
														<code className="ml-1 text-[11px]">
															{VARIANT_ENV_SUFFIXES[audience]}
														</code>
													) : null}
												</dt>
												<dd className="shrink-0 tabular-nums">
													{stored[audience]} credential
													{stored[audience] === 1 ? "" : "s"} ·{" "}
													{envCount === 0
														? "no env keys"
														: `${envCount} env key${envCount === 1 ? "" : "s"}`}
												</dd>
											</div>
										);
									})}
								</dl>
								{selectedEntry.apiKeyEnvVar ? (
									<p className="text-xs text-muted-foreground">
										Env keys come from <code>{selectedEntry.apiKeyEnvVar}</code>{" "}
										(comma-separated) and its variant overrides. A credential
										here takes precedence for its audience and the variable is
										ignored entirely once one exists.
									</p>
								) : null}
							</div>
						) : null}
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="token">API key</Label>
						<Textarea
							id="token"
							value={token}
							rows={3}
							// API keys and service-account JSON have no spaces to wrap at,
							// and the base Textarea uses `field-sizing: content`, which
							// sizes the box to the longest unbroken line — a long key
							// stretches it past the dialog and scrolls the whole thing
							// sideways. Breaking anywhere keeps it inside its column.
							className="break-all"
							onChange={(event) => setToken(event.target.value)}
							placeholder={
								isEdit
									? `Leave blank to keep ${credential?.maskedToken}`
									: "Provider API key or service-account JSON"
							}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="comment">Note</Label>
						<Input
							id="comment"
							value={comment}
							onChange={(event) => setComment(event.target.value)}
							placeholder="e.g. billing account #2, high-quota key"
						/>
						<p className="text-xs text-muted-foreground">
							Shown in this table so several keys for the same provider stay
							tellable apart.
						</p>
					</div>

					{selectedEntry && selectedEntry.configKeys.length > 0 ? (
						<div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
							<p className="text-sm font-medium">
								{selectedEntry.name} settings
							</p>
							{selectedEntry.configKeys.map((entry) => (
								<div key={entry.key} className="flex flex-col gap-1">
									<Label htmlFor={`config-${entry.key}`}>
										{entry.key}
										{entry.required ? (
											<span className="ml-1 text-destructive">*</span>
										) : null}
									</Label>
									<Input
										id={`config-${entry.key}`}
										value={config[entry.key] ?? ""}
										onChange={(event) =>
											setConfig((current) => ({
												...current,
												[entry.key]: event.target.value,
											}))
										}
										placeholder={entry.envVar}
									/>
								</div>
							))}
						</div>
					) : null}

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-2">
							<Label htmlFor="variant">Applies to</Label>
							<Select
								value={variant}
								onValueChange={(value) => setVariant(value as Variant)}
							>
								<SelectTrigger id="variant">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(Object.keys(VARIANT_LABELS) as Variant[]).map((value) => (
										<SelectItem key={value} value={value}>
											{VARIANT_LABELS[value]}
											{VARIANT_ENV_SUFFIXES[value]
												? ` (${VARIANT_ENV_SUFFIXES[value]})`
												: ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{variant === "default"
									? "Serves every organization that has no credential for its own audience."
									: `Serves only these organizations, the way ${
											selectedEntry?.apiKeyEnvVar
												? `${selectedEntry.apiKeyEnvVar}${VARIANT_ENV_SUFFIXES[variant]}`
												: `an ${VARIANT_ENV_SUFFIXES[variant]} env var`
										} would. They fall back to an "All organizations" credential when none is set here.`}
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="region">Region</Label>
							<Select
								value={region || ANY_REGION}
								onValueChange={(value) =>
									setRegion(value === ANY_REGION ? "" : value)
								}
								disabled={!isRegionScoped}
							>
								<SelectTrigger id="region">
									{/* A controlled Select always resolves to an item's text,
									    so the not-scoped case is rendered directly instead of
									    via the placeholder, which would never show. */}
									{isRegionScoped ? (
										<SelectValue placeholder="Any region" />
									) : (
										<span className="text-muted-foreground">
											Not region-scoped
										</span>
									)}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ANY_REGION}>Any region</SelectItem>
									{selectedEntry?.regions.map((entry) => {
										const used = regionUsage.get(entry.id) ?? 0;
										return (
											<SelectItem key={entry.id} value={entry.id}>
												{/* The catalogue's own label already marks the
												    default region, so it is not repeated here. */}
												{entry.label}
												{used > 0 ? ` · ${used} configured` : ""}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{!isRegionScoped
									? `${selectedEntry?.name ?? "This provider"} serves one endpoint for every request, so its credentials are not region-scoped.`
									: region
										? "Only requests routed to this region use this credential."
										: "Serves every region the provider covers."}
							</p>
						</div>
					</div>

					{isEdit ? (
						<div className="flex flex-col gap-2">
							<Label htmlFor="status">Status</Label>
							<Select
								value={status}
								onValueChange={(value) =>
									setStatus(value as "active" | "inactive")
								}
							>
								<SelectTrigger id="status">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="inactive">Inactive</SelectItem>
								</SelectContent>
							</Select>
						</div>
					) : null}

					<div className="flex items-start gap-2">
						<Checkbox
							id="skip-validation"
							checked={skipValidation}
							onCheckedChange={(checked) => setSkipValidation(checked === true)}
						/>
						<div className="flex flex-col gap-1">
							<Label htmlFor="skip-validation" className="font-normal">
								Skip validation
							</Label>
							<p className="text-xs text-muted-foreground">
								Saving sends one minimal request through this credential to
								confirm it works. Skip it for providers with no chat model to
								test against, or when the upstream is temporarily down.
							</p>
						</div>
					</div>

					{error ? <p className="text-sm text-destructive">{error}</p> : null}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={loading || (!isEdit && (!provider || !token))}
					>
						{loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
						{isEdit ? "Save" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
