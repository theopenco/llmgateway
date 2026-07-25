"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
		},
	) => Promise<MutationResult>;
	onDelete: (id: string) => Promise<MutationResult>;
}

function ProviderCell({ provider }: { provider: string }) {
	const Icon = getProviderIcon(provider);
	return (
		<div className="flex items-center gap-2">
			{Icon ? <Icon className="h-4 w-4" /> : null}
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
					<TableBody>
						{credentials.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={8}
									className="py-10 text-center text-muted-foreground"
								>
									No managed credentials yet. Providers fall back to their{" "}
									<code>LLM_*</code> environment variables until one is added.
								</TableCell>
							</TableRow>
						) : (
							credentials.map((credential) => {
								const configEntries = Object.entries(credential.config ?? {});
								return (
									<TableRow key={credential.id}>
										<TableCell>
											<ProviderCell provider={credential.provider} />
										</TableCell>
										<TableCell className="font-mono text-xs">
											{credential.maskedToken}
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
												<span className="text-sm text-muted-foreground">—</span>
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
													onClick={() => setEditing(credential)}
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setDeleteError(null);
														setDeleting(credential);
													}}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>

			{creating ? (
				<CredentialDialog
					catalog={catalog}
					onClose={() => setCreating(false)}
					onSubmit={async (values) => {
						const result = await onCreate({
							provider: values.provider,
							token: values.token,
							comment: values.comment || undefined,
							variant: values.variant,
							region: values.region || undefined,
							config: values.config,
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
					onClose={() => setEditing(null)}
					onSubmit={async (values) => {
						const result = await onUpdate(editing.id, {
							...(values.token ? { token: values.token } : {}),
							comment: values.comment || null,
							variant: values.variant,
							region: values.region || null,
							status: values.status,
							config: values.config,
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
}

function CredentialDialog({
	catalog,
	credential,
	catalogEntry,
	onClose,
	onSubmit,
}: {
	catalog: ProviderCredentialCatalogEntry[];
	credential?: ProviderCredential;
	catalogEntry?: ProviderCredentialCatalogEntry;
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
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedEntry =
		catalogEntry ?? catalog.find((entry) => entry.id === provider);

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
						<Select
							value={provider}
							onValueChange={(value) => {
								setProvider(value);
								setConfig({});
							}}
							disabled={isEdit}
						>
							<SelectTrigger id="provider">
								<SelectValue placeholder="Select a provider" />
							</SelectTrigger>
							<SelectContent>
								{catalog.map((entry) => (
									<SelectItem key={entry.id} value={entry.id}>
										{entry.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{selectedEntry?.apiKeyEnvVar ? (
							<p className="text-xs text-muted-foreground">
								Replaces <code>{selectedEntry.apiKeyEnvVar}</code> and its
								companion variables.
								{selectedEntry.apiKeyEnvConfigured
									? " Those are currently set on this deployment; credentials here take precedence and the variables are ignored entirely once one exists."
									: ""}
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="token">API key</Label>
						<Textarea
							id="token"
							value={token}
							rows={3}
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
							<Input
								id="region"
								value={region}
								onChange={(event) => setRegion(event.target.value)}
								placeholder="Any region"
							/>
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
