"use client";

import {
	CheckCheck,
	CheckCircle2,
	ChevronDown,
	ClipboardPaste,
	Loader2,
	MinusCircle,
	Pencil,
	Plus,
	Trash2,
	XCircle,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ProviderCredentialsSpendOverview } from "@/components/provider-credentials-spend-overview";
import { ProviderKeySpendCell } from "@/components/provider-key-spend-cell";
import { ProviderKeySpendDialog } from "@/components/provider-key-spend-dialog";
import { ProviderKeyStatusBadge } from "@/components/provider-key-status-badge";
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
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { thrownErrorMessage } from "@/lib/api-error";
import { formatUsd, isInRotation } from "@/lib/provider-key-spend";
import { parseProviderModelList } from "@/lib/provider-model-list";
import { cn } from "@/lib/utils";

import { getProviderIcon, PROVIDER_MODEL_KINDS } from "@llmgateway/shared";
import {
	MultiModelIdSelector,
	ReorderableItem,
	ReorderableList,
	SearchableSelect,
} from "@llmgateway/shared/components";

import type {
	CredentialTestInput,
	ProviderCredential,
	ProviderCredentialCatalogEntry,
	ProviderCredentialModelVerification,
	ProviderCredentialSelfTestResult,
} from "@/lib/admin-provider-credentials";
import type { ProviderModelKind } from "@llmgateway/shared";

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

/**
 * Sentinel for "no provider filter". Radix and the query string both need a
 * concrete value, and an absent `provider` param is what means unfiltered.
 */
const ALL_PROVIDERS = "__all__";

type VariantCounts = Record<Variant, number>;

const NO_CREDENTIALS: VariantCounts = {
	default: 0,
	enterprise: 0,
	plans: 0,
};

const NO_MODELS: string[] = [];

const NO_MODELS_BY_KIND: Record<ProviderModelKind, string[]> = {
	text: [],
	image: [],
	ocr: [],
	embedding: [],
	video: [],
};

const MODEL_KIND_LABELS: Record<ProviderModelKind, string> = {
	text: "Text models",
	image: "Image models",
	ocr: "OCR models",
	embedding: "Embedding models",
	video: "Video models",
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
	/**
	 * Which process the listed `LLM_*` keys were read from. The gateway publishes
	 * its own set (the keys that actually serve traffic); `api` means no snapshot
	 * was available and the backend fell back to its own environment, which in a
	 * split deployment normally holds no provider keys at all.
	 */
	envSource: "gateway" | "api";
	/** ISO timestamp of the gateway's snapshot; null when envSource is `api`. */
	envPublishedAt: string | null;
	onCreate: (body: {
		provider: string;
		token: string;
		comment?: string;
		variant?: Variant;
		region?: string;
		config?: Record<string, string>;
		usageLimit?: string | null;
		allowedModels?: string[] | null;
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
			usageLimit?: string | null;
			allowedModels?: string[] | null;
			skipValidation?: boolean;
		},
	) => Promise<MutationResult>;
	onDelete: (id: string) => Promise<MutationResult>;
	onReorder: (
		provider: string,
		credentialIds: string[],
	) => Promise<MutationResult>;
	onSelfTest: (
		body: CredentialTestInput,
	) => Promise<MutationResult & { result?: ProviderCredentialSelfTestResult }>;
	onVerifyModels: (
		body: CredentialTestInput & { models: string[] },
	) => Promise<
		MutationResult & { result?: ProviderCredentialModelVerification }
	>;
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

type EnvCredential = ProviderCredentialCatalogEntry["envCredentials"][number];

/**
 * An API key configured through the deployment's environment, shown alongside
 * the managed credentials so an operator sees every key that can serve a
 * provider in one table. Read-only by nature: it can only be changed by
 * redeploying, so there is no edit/delete and it takes no part in reordering.
 * `superseded` marks it visibly unused once the provider has any managed
 * credential — the gateway then ignores every variable of that provider,
 * whatever audience or region the credential is scoped to.
 */
function EnvCredentialRow({
	provider,
	entry,
	superseded,
}: {
	provider: string;
	entry: EnvCredential;
	superseded: boolean;
}) {
	return (
		<TableRow className="border-b bg-muted/40 transition-colors hover:bg-muted/60">
			<TableCell className="w-10">
				<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
					env
				</span>
			</TableCell>
			<TableCell>
				<div className={superseded ? "opacity-60" : undefined}>
					<ProviderCell provider={provider} />
				</div>
			</TableCell>
			<TableCell className="font-mono text-xs">
				<div className={superseded ? "text-muted-foreground" : undefined}>
					{entry.maskedToken}
				</div>
				<div
					className="text-[11px] text-muted-foreground"
					title={`Matches usedApiKeyHash on logs served by this key: ${entry.tokenHash}`}
				>
					{entry.tokenHash.slice(0, 12)}
				</div>
			</TableCell>
			<TableCell className="max-w-[260px]">
				<code className="text-xs text-muted-foreground">
					{entry.envVar}
					{entry.index > 0 ? `[${entry.index}]` : ""}
				</code>
			</TableCell>
			<TableCell className="text-sm">
				{VARIANT_LABELS[entry.variant as Variant] ?? entry.variant}
			</TableCell>
			<TableCell className="text-sm">{entry.region || "Any"}</TableCell>
			<TableCell>
				<span
					className="text-sm text-muted-foreground"
					title="Env keys always serve the provider's full catalogue; model restrictions apply to managed credentials only."
				>
					All
				</span>
			</TableCell>
			<TableCell>
				<span className="text-sm text-muted-foreground">—</span>
			</TableCell>
			<TableCell>
				<span
					className="text-sm text-muted-foreground"
					title="Spend tracking and limits apply to managed credentials only; env keys are not attributed individually."
				>
					—
				</span>
			</TableCell>
			<TableCell>
				{superseded ? (
					<Badge
						variant="secondary"
						className="text-muted-foreground"
						title="This provider has a managed credential, so the gateway no longer reads any of its LLM_* variables. Safe to remove on the next deploy."
					>
						unused
					</Badge>
				) : (
					<Badge title="This provider has no managed credential yet, so this variable still serves its traffic.">
						in use
					</Badge>
				)}
			</TableCell>
			<TableCell className="text-right">
				<span
					className="text-xs text-muted-foreground"
					title="Environment keys can only be changed by redeploying."
				>
					read-only
				</span>
			</TableCell>
		</TableRow>
	);
}

/**
 * Renders the snapshot time in UTC rather than the viewer's locale.
 *
 * This component is server-rendered before it hydrates, and `toLocaleString()`
 * resolves against the runtime's locale and time zone — a server in UTC and a
 * browser anywhere else produce different text for the same instant, which is a
 * hydration mismatch. A fixed UTC rendering is also the more useful one here:
 * every operator reading it sees the same timestamp as the gateway's logs.
 */
function formatPublishedAt(publishedAt: string): string {
	const published = new Date(publishedAt);
	if (Number.isNaN(published.getTime())) {
		return "an unknown time";
	}
	const [date, time] = published.toISOString().split("T");
	return `${date} ${time.slice(0, 5)} UTC`;
}

/**
 * Says where the `env` rows came from.
 *
 * The gateway and the API are separate deployments and only the gateway is
 * given `LLM_*` variables, so it publishes what it holds (masked, never the
 * tokens) for this page to read. Without that snapshot the backend can only
 * report its own environment — which normally holds nothing — and an operator
 * would otherwise read an empty table as "no keys configured" rather than "not
 * visible from here".
 */
function EnvSourceNote({
	source,
	publishedAt,
	envKeyCount,
}: {
	source: "gateway" | "api";
	publishedAt: string | null;
	envKeyCount: number;
}) {
	if (source === "gateway") {
		return (
			<p className="text-xs text-muted-foreground">
				{envKeyCount} environment {envKeyCount === 1 ? "key is" : "keys are"}{" "}
				configured on the gateway, reported{" "}
				{publishedAt ? formatPublishedAt(publishedAt) : "recently"}.
			</p>
		);
	}

	return (
		<p className="text-xs text-muted-foreground">
			No gateway has published its <code>LLM_*</code> keys, so any listed below
			are the ones this backend can see itself. A gateway publishes on startup
			and refreshes every 5 minutes; if this persists, check that it runs a
			build with the publisher and shares this Redis.
		</p>
	);
}

export function ProviderCredentialsManager({
	credentials,
	catalog,
	envSource,
	envPublishedAt,
	onCreate,
	onUpdate,
	onDelete,
	onReorder,
	onSelfTest,
	onVerifyModels,
}: ProviderCredentialsManagerProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const providerFilter = searchParams.get("provider") ?? ALL_PROVIDERS;
	const view = searchParams.get("view") === "spend" ? "spend" : "credentials";

	// Kept in the URL like the provider filter, so a shared link opens on the
	// same tab. The credentials table is the default: with dozens of providers
	// the chart grid would otherwise push it off screen.
	const setView = useCallback(
		(next: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === "spend") {
				params.set("view", "spend");
			} else {
				params.delete("view");
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);

	// Kept in the URL so a filtered view can be reloaded, shared and navigated
	// back to, matching how the other admin tables persist their filters.
	const setProviderFilter = useCallback(
		(next: string) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === ALL_PROVIDERS) {
				params.delete("provider");
			} else {
				params.set("provider", next);
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);

	const [editing, setEditing] = useState<ProviderCredential | null>(null);
	const [creating, setCreating] = useState(false);
	const [deleting, setDeleting] = useState<ProviderCredential | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const catalogById = useMemo(
		() => new Map(catalog.map((entry) => [entry.id, entry])),
		[catalog],
	);

	const providerNames = useMemo(
		() => Object.fromEntries(catalog.map((entry) => [entry.id, entry.name])),
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

	// Only providers that actually have credentials — filtering to an empty
	// provider is a dead end, and the create dialog is where you go to add one.
	const filterOptions = useMemo(() => {
		const options = Array.from(serverOrder.entries()).map(
			([provider, ids]) => ({
				value: provider,
				label: catalogById.get(provider)?.name ?? provider,
				keywords: provider,
				icon: <ProviderIcon provider={provider} />,
				annotation: (
					<Badge variant="secondary" className="text-[11px]">
						{ids.length}
					</Badge>
				),
			}),
		);
		return [
			{
				value: ALL_PROVIDERS,
				label: "All providers",
				annotation: (
					<Badge variant="secondary" className="text-[11px]">
						{credentials.length}
					</Badge>
				),
			},
			...options,
		];
	}, [serverOrder, catalogById, credentials.length]);

	// Display-only: `order` keeps every provider so the counts in the create
	// dialog and the reorder payloads stay whole. Filtering by provider also
	// leaves each shown group complete, which the reorder endpoint requires.
	const visibleGroups = useMemo(
		() =>
			Array.from(order.entries()).filter(
				([provider]) =>
					providerFilter === ALL_PROVIDERS || provider === providerFilter,
			),
		[order, providerFilter],
	);

	/**
	 * Rotation position per credential id, counting only the credentials the
	 * gateway will actually consider. Ids absent from the map are out of
	 * rotation.
	 */
	const rotationPositions = useMemo(() => {
		const positions = new Map<string, number>();
		order.forEach((ids) => {
			let position = 0;
			for (const id of ids) {
				const credential = credentialById.get(id);
				if (credential && isInRotation(credential)) {
					position++;
					positions.set(id, position);
				}
			}
		});
		return positions;
	}, [order, credentialById]);

	const envByProvider = useMemo(() => {
		const map = new Map<string, EnvCredential[]>();
		for (const entry of catalog) {
			if (entry.envCredentials.length > 0) {
				map.set(entry.id, entry.envCredentials);
			}
		}
		return map;
	}, [catalog]);

	const envKeyCount = useMemo(
		() =>
			catalog.reduce((total, entry) => total + entry.envCredentials.length, 0),
		[catalog],
	);

	// Providers with an ACTIVE managed credential. The gateway stops reading a
	// provider's environment the moment it has one — whatever that credential's
	// audience or region — so every env key of such a provider is unused.
	const managedProviders = useMemo(() => {
		const set = new Set<string>();
		for (const credential of credentials) {
			if (credential.status === "active") {
				set.add(credential.provider);
			}
		}
		return set;
	}, [credentials]);

	const isEnvSuperseded = useCallback(
		(provider: string) => managedProviders.has(provider),
		[managedProviders],
	);

	// Providers whose only keys live in the environment get their own read-only
	// group below the managed ones.
	const envOnlyProviders = useMemo(
		() =>
			Array.from(envByProvider.keys())
				.filter((provider) => !serverOrder.has(provider))
				.filter(
					(provider) =>
						providerFilter === ALL_PROVIDERS || provider === providerFilter,
				)
				.sort(),
		[envByProvider, serverOrder, providerFilter],
	);

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
		<Tabs value={view} onValueChange={setView} className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<TabsList>
					<TabsTrigger value="credentials">Credentials</TabsTrigger>
					<TabsTrigger value="spend">Spend</TabsTrigger>
				</TabsList>
				<div className="flex flex-1 flex-wrap items-center justify-end gap-3">
					<div className="w-full sm:w-72">
						<SearchableSelect
							value={providerFilter}
							onValueChange={setProviderFilter}
							options={filterOptions}
							placeholder="All providers"
							searchPlaceholder="Filter by provider..."
							emptyMessage="No providers found."
							aria-label="Filter by provider"
						/>
					</div>
					<Button onClick={() => setCreating(true)}>
						<Plus className="mr-1 h-4 w-4" />
						Add credential
					</Button>
				</div>
			</div>

			{/* Inactive tab content is unmounted, so the charts and their query
			    only exist once the Spend tab is opened — with dozens of providers
			    the table view stays free of them entirely. */}
			<TabsContent value="spend">
				<ProviderCredentialsSpendOverview
					providerFilter={
						providerFilter === ALL_PROVIDERS ? null : providerFilter
					}
					providerNames={providerNames}
				/>
			</TabsContent>

			<TabsContent value="credentials" className="flex flex-col gap-2">
				<EnvSourceNote
					source={envSource}
					publishedAt={envPublishedAt}
					envKeyCount={envKeyCount}
				/>
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
								<TableHead>Models</TableHead>
								<TableHead>Settings</TableHead>
								<TableHead>Spend</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						{/* Unfiltered only: with a provider filter applied, an empty
						    result says nothing about the other providers, so it belongs
						    in the "no credentials for this provider" branch below rather
						    than in a claim about the whole deployment. */}
						{providerFilter === ALL_PROVIDERS &&
						credentials.length === 0 &&
						envOnlyProviders.length === 0 ? (
							<TableBody>
								<TableRow>
									<TableCell
										colSpan={11}
										className="py-10 text-center text-muted-foreground"
									>
										{envSource === "gateway" ? (
											<>
												No managed credentials yet, and the gateway reports no{" "}
												<code>LLM_*</code> keys either — nothing can serve
												credits-mode traffic.
											</>
										) : (
											<>
												No managed credentials yet. Providers keep reading the
												gateway&apos;s <code>LLM_*</code> variables, which
												cannot be listed here until it publishes them.
											</>
										)}
									</TableCell>
								</TableRow>
							</TableBody>
						) : visibleGroups.length === 0 && envOnlyProviders.length === 0 ? (
							// Reachable by hand-editing the query string, or by following a
							// link to a provider whose last credential has since been removed.
							<TableBody>
								<TableRow>
									<TableCell
										colSpan={11}
										className="py-10 text-center text-muted-foreground"
									>
										No credentials for this provider.{" "}
										<button
											type="button"
											className="underline underline-offset-2"
											onClick={() => setProviderFilter(ALL_PROVIDERS)}
										>
											Show all providers
										</button>
									</TableCell>
								</TableRow>
							</TableBody>
						) : (
							// One tbody per provider: several are valid inside a table and
							// stack seamlessly, and it makes dragging a row into another
							// provider's group structurally impossible.
							<>
								{visibleGroups.map(([provider, ids]) => (
									<ReorderableList
										key={provider}
										as="tbody"
										ids={ids}
										disabled={savingProvider === provider}
										onReorder={(next) => applyReorder(provider, next)}
										onCommit={(next) => void commitReorder(provider, next)}
									>
										{ids.map((id: string) => {
											const credential = credentialById.get(id);
											if (!credential) {
												return null;
											}
											// Position the gateway would actually try this credential
											// at. Selection skips anything not active, so numbering
											// every row by its list index would show a shut-off key
											// as "#1" while the gateway silently serves from the one
											// below it.
											const rotationPosition =
												rotationPositions.get(id) ?? null;
											const configEntries = Object.entries(
												credential.config ?? {},
											);
											return (
												<ReorderableItem
													key={credential.id}
													id={credential.id}
													as="tr"
													itemLabel={`${credential.provider} credential ${credential.maskedToken}`}
													className={cn(
														"border-b bg-card transition-colors hover:bg-muted/50",
														rotationPosition === null && "bg-muted/30",
													)}
												>
													{(handle) => (
														<>
															<TableCell className="w-10">
																<div className="flex items-center gap-1">
																	{handle}
																	{rotationPosition === null ? (
																		<span
																			className="text-xs text-muted-foreground"
																			title="Not in rotation: the gateway only selects active credentials, so this one is skipped entirely."
																		>
																			—
																		</span>
																	) : (
																		<span
																			className="text-xs tabular-nums text-muted-foreground"
																			title={`Position ${rotationPosition} in this provider's rotation. The gateway tries credentials in this order and falls through to the next when one is unhealthy.`}
																		>
																			{rotationPosition}
																		</span>
																	)}
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
																{VARIANT_LABELS[
																	credential.variant as Variant
																] ?? credential.variant}
															</TableCell>
															<TableCell className="text-sm">
																{credential.region || "Any"}
															</TableCell>
															<TableCell>
																{credential.allowedModels &&
																credential.allowedModels.length > 0 ? (
																	<Badge
																		variant="secondary"
																		className="text-[11px]"
																		title={`Only serves: ${credential.allowedModels.join(", ")}`}
																	>
																		{credential.allowedModels.length} model
																		{credential.allowedModels.length === 1
																			? ""
																			: "s"}
																	</Badge>
																) : (
																	<span
																		className="text-sm text-muted-foreground"
																		title="Serves every model of the provider."
																	>
																		All
																	</span>
																)}
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
															<TableCell className="text-sm">
																<ProviderKeySpendCell keyRow={credential} />
															</TableCell>
															<TableCell>
																<ProviderKeyStatusBadge keyRow={credential} />
															</TableCell>
															<TableCell className="text-right">
																<div className="flex justify-end gap-1">
																	<ProviderKeySpendDialog
																		providerKeyId={credential.id}
																		label={`${credential.provider} ${credential.maskedToken}`}
																	/>
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
										{(envByProvider.get(provider) ?? []).map((entry) => (
											<EnvCredentialRow
												key={`${entry.envVar}:${entry.index}`}
												provider={provider}
												entry={entry}
												superseded={isEnvSuperseded(provider)}
											/>
										))}
									</ReorderableList>
								))}
								{envOnlyProviders.map((provider) => (
									<TableBody key={`env-${provider}`}>
										{(envByProvider.get(provider) ?? []).map((entry) => (
											<EnvCredentialRow
												key={`${entry.envVar}:${entry.index}`}
												provider={provider}
												entry={entry}
												superseded={isEnvSuperseded(provider)}
											/>
										))}
									</TableBody>
								))}
							</>
						)}
					</Table>
				</div>
			</TabsContent>

			{creating ? (
				<CredentialDialog
					catalog={catalog}
					credentialCounts={credentialCounts}
					regionsInUse={regionsInUse}
					onClose={() => setCreating(false)}
					onSelfTest={onSelfTest}
					onVerifyModels={onVerifyModels}
					onSubmit={async (values) => {
						const result = await onCreate({
							provider: values.provider,
							token: values.token,
							comment: values.comment || undefined,
							variant: values.variant,
							region: values.region || undefined,
							config: values.config,
							usageLimit: values.usageLimit || undefined,
							allowedModels:
								values.allowedModels.length > 0 ? values.allowedModels : null,
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
					onSelfTest={onSelfTest}
					onVerifyModels={onVerifyModels}
					onSubmit={async (values) => {
						const result = await onUpdate(editing.id, {
							...(values.token ? { token: values.token } : {}),
							comment: values.comment || null,
							variant: values.variant,
							region: values.region || null,
							status: values.status,
							config: values.config,
							usageLimit: values.usageLimit || null,
							allowedModels:
								values.allowedModels.length > 0 ? values.allowedModels : null,
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
		</Tabs>
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
	/** USD spend cap as entered; empty string means no limit. */
	usageLimit: string;
	/** Canonical model ids the credential may serve; empty means unrestricted. */
	allowedModels: string[];
	skipValidation: boolean;
}

const nonNegativeDecimalPattern = /^\d+(?:\.\d+)?$/;

type ModelVerificationEntry =
	ProviderCredentialModelVerification["results"][number];

interface SelfTestOutcome {
	result?: ProviderCredentialSelfTestResult;
	error?: string;
}

function PasteAllowedModelsDialog({
	availableIds,
	providerName,
	value,
	onChange,
}: {
	availableIds: readonly string[];
	providerName: string;
	value: string[];
	onChange: (ids: string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const parsed = useMemo(
		() => parseProviderModelList(text, availableIds),
		[text, availableIds],
	);
	const newModelIds = useMemo(() => {
		const selected = new Set(value);
		return parsed.modelIds.filter((modelId) => !selected.has(modelId));
	}, [parsed.modelIds, value]);

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			setText("");
		}
	};

	const handleAdd = (event: React.FormEvent) => {
		event.preventDefault();
		if (parsed.unknownIds.length > 0 || newModelIds.length === 0) {
			return;
		}

		onChange([...value, ...newModelIds]);
		setOpen(false);
		setText("");
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" size="sm">
					<ClipboardPaste />
					Paste model IDs
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<form className="flex flex-col gap-4" onSubmit={handleAdd}>
					<DialogHeader>
						<DialogTitle>Paste model IDs</DialogTitle>
						<DialogDescription>
							Add a complete list at once. Existing selections stay selected,
							and duplicate IDs are ignored.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<Label htmlFor="allowed-model-list">Model IDs</Label>
						<Textarea
							id="allowed-model-list"
							value={text}
							onChange={(event) => setText(event.target.value)}
							placeholder={"model-id-one\nmodel-id-two\nmodel-id-three"}
							rows={9}
							className="min-h-48 resize-y font-mono text-xs"
							aria-describedby="allowed-model-list-hint"
							aria-invalid={parsed.unknownIds.length > 0}
							autoFocus
						/>
						<p
							id="allowed-model-list-hint"
							className="text-xs text-muted-foreground"
						>
							Separate IDs with new lines, commas, spaces, or semicolons.
							Provider-prefixed IDs are accepted too.
						</p>
					</div>

					{parsed.unknownIds.length > 0 ? (
						<div
							className="flex flex-col gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
							role="alert"
						>
							<p>
								{parsed.unknownIds.length === 1
									? `This model ID is not available for ${providerName}:`
									: `These ${parsed.unknownIds.length} model IDs are not available for ${providerName}:`}
							</p>
							<ul className="max-h-28 space-y-1 overflow-y-auto">
								{parsed.unknownIds.map((modelId) => (
									<li key={modelId} className="break-all font-mono text-xs">
										{modelId}
									</li>
								))}
							</ul>
							<p className="text-xs">Remove or correct them to continue.</p>
						</div>
					) : parsed.modelIds.length > 0 ? (
						<p className="text-sm text-muted-foreground" aria-live="polite">
							{newModelIds.length > 0
								? `${newModelIds.length} new model${newModelIds.length === 1 ? "" : "s"} ready to add.`
								: "Every model in this list is already selected."}
						</p>
					) : null}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={
								parsed.unknownIds.length > 0 || newModelIds.length === 0
							}
						>
							{newModelIds.length === 0
								? "Add models"
								: `Add ${newModelIds.length} model${newModelIds.length === 1 ? "" : "s"}`}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Why the self-test failed, in the order the reason is most specific: the
 * gateway could not run the probe at all, the provider explained itself, or it
 * only answered with a status. The generic sentence is the last resort — it is
 * all the admin gets, so nothing more specific may be dropped on the way here.
 */
function selfTestFailureReason(outcome: SelfTestOutcome): string {
	const statusCode = outcome.result?.statusCode;
	const suffix = statusCode ? ` (HTTP ${statusCode})` : "";
	const reason = outcome.error ?? outcome.result?.error;
	return reason
		? `${reason}${suffix}`
		: `the provider rejected the request${suffix}`;
}

function CredentialDialog({
	catalog,
	credential,
	catalogEntry,
	credentialCounts,
	regionsInUse,
	onClose,
	onSubmit,
	onSelfTest,
	onVerifyModels,
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
	onSelfTest: ProviderCredentialsManagerProps["onSelfTest"];
	onVerifyModels: ProviderCredentialsManagerProps["onVerifyModels"];
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
	const [usageLimit, setUsageLimit] = useState(credential?.usageLimit ?? "");
	const [allowedModels, setAllowedModels] = useState<string[]>(
		credential?.allowedModels ?? [],
	);
	const [skipValidation, setSkipValidation] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Self-test / verify-models probes run against the CURRENT form values (not
	// what is stored), so an admin can check edits before saving. Results are
	// cleared whenever an input that changes what the probe would send changes.
	const [selfTestLoading, setSelfTestLoading] = useState(false);
	const [selfTestOutcome, setSelfTestOutcome] = useState<
		SelfTestOutcome | undefined
	>();
	const [verifyLoading, setVerifyLoading] = useState(false);
	const [verifyOutcome, setVerifyOutcome] = useState<
		{ result?: ProviderCredentialModelVerification; error?: string } | undefined
	>();
	const verifyRequestId = useRef(0);

	const clearVerifyResults = useCallback(() => {
		verifyRequestId.current += 1;
		setVerifyLoading(false);
		setVerifyOutcome(undefined);
	}, []);

	const clearProbeResults = useCallback(() => {
		setSelfTestOutcome(undefined);
		clearVerifyResults();
	}, [clearVerifyResults]);

	/**
	 * The credential the test endpoints should probe: the stored one (its token
	 * is read server-side) with any dialog edits layered on top.
	 */
	const credentialUnderTest = useCallback(
		(): CredentialTestInput => ({
			...(credential ? { credentialId: credential.id } : {}),
			provider,
			...(token ? { token } : {}),
			config,
			region: region || null,
		}),
		[credential, provider, token, config, region],
	);

	async function handleSelfTest() {
		setSelfTestLoading(true);
		setSelfTestOutcome(undefined);
		try {
			const outcome = await onSelfTest(credentialUnderTest());
			setSelfTestOutcome(
				outcome.success
					? { result: outcome.result }
					: { error: outcome.error ?? "Failed to test credential" },
			);
		} catch (cause) {
			setSelfTestOutcome({
				error: thrownErrorMessage(cause, "Failed to test credential"),
			});
		} finally {
			setSelfTestLoading(false);
		}
	}

	async function handleVerifyModels() {
		const requestId = verifyRequestId.current + 1;
		verifyRequestId.current = requestId;
		setVerifyLoading(true);
		setVerifyOutcome(undefined);
		try {
			const outcome = await onVerifyModels({
				...credentialUnderTest(),
				models: allowedModels,
			});
			if (verifyRequestId.current !== requestId) {
				return;
			}
			setVerifyOutcome(
				outcome.success
					? { result: outcome.result }
					: { error: outcome.error ?? "Failed to verify models" },
			);
		} catch (cause) {
			if (verifyRequestId.current !== requestId) {
				return;
			}
			setVerifyOutcome({
				error: thrownErrorMessage(cause, "Failed to verify models"),
			});
		} finally {
			if (verifyRequestId.current === requestId) {
				setVerifyLoading(false);
			}
		}
	}

	const selectedEntry =
		catalogEntry ?? catalog.find((entry) => entry.id === provider);
	const isRegionScoped = (selectedEntry?.regions.length ?? 0) > 0;
	const availableModels = selectedEntry?.models ?? NO_MODELS;
	const modelsByKind = selectedEntry?.modelsByKind ?? NO_MODELS_BY_KIND;
	const allAvailableModelsSelected = useMemo(() => {
		if (availableModels.length === 0) {
			return false;
		}
		const selected = new Set(allowedModels);
		return availableModels.every((modelId) => selected.has(modelId));
	}, [allowedModels, availableModels]);
	const exactAvailableModelSelection =
		allAvailableModelsSelected &&
		allowedModels.length === availableModels.length;

	// Settings where exactly one member may be filled (e.g. Azure's resource vs
	// base URL). Filling one disables its siblings, so the invalid combination
	// cannot be entered rather than only being rejected on save.
	const exclusiveGroups = useMemo(
		() => selectedEntry?.exclusiveConfigGroups ?? [],
		[selectedEntry],
	);
	const filledExclusiveKeys = useCallback(
		(keys: string[]) => keys.filter((key) => config[key]?.trim()),
		[config],
	);
	const exclusiveGroupOf = useCallback(
		(key: string) => exclusiveGroups.find((group) => group.keys.includes(key)),
		[exclusiveGroups],
	);
	const isSupersededExclusiveKey = useCallback(
		(key: string) => {
			const group = exclusiveGroupOf(key);
			if (!group) {
				return false;
			}
			const filled = filledExclusiveKeys(group.keys);
			return filled.length > 0 && !filled.includes(key);
		},
		[exclusiveGroupOf, filledExclusiveKeys],
	);
	const hasUnsatisfiedExclusiveGroup = exclusiveGroups.some(
		(group) => filledExclusiveKeys(group.keys).length !== 1,
	);

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
		const trimmedLimit = usageLimit.trim();
		if (trimmedLimit && !nonNegativeDecimalPattern.test(trimmedLimit)) {
			setError("Max spend must be a non-negative number.");
			return;
		}
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
			usageLimit: trimmedLimit,
			allowedModels,
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
								// Regions and models are per-provider; carrying either over
								// would be rejected by the server.
								setRegion("");
								setAllowedModels([]);
								clearProbeResults();
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
							onChange={(event) => {
								setToken(event.target.value);
								clearProbeResults();
							}}
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
							{exclusiveGroups.map((group) => {
								const filled = filledExclusiveKeys(group.keys);
								const alternatives = group.keys.filter(
									(key) => key !== filled[0],
								);
								return (
									<p
										key={group.keys.join("|")}
										className={
											filled.length > 1
												? "text-xs text-destructive"
												: "text-xs text-muted-foreground"
										}
									>
										{filled.length === 0 ? (
											<>
												Set exactly one of{" "}
												<span className="font-medium">
													{group.keys.join(" or ")}
												</span>
												. {group.description}
											</>
										) : filled.length === 1 ? (
											<>
												Using <span className="font-medium">{filled[0]}</span>.
												Clear it to use {alternatives.join(" or ")} instead.
											</>
										) : (
											<>
												Only one of {group.keys.join(" or ")} may be set — clear
												all but one to save.
											</>
										)}
									</p>
								);
							})}
							{selectedEntry.configKeys.map((entry) => {
								const superseded = isSupersededExclusiveKey(entry.key);
								const group = exclusiveGroupOf(entry.key);
								return (
									<div key={entry.key} className="flex flex-col gap-1">
										<Label htmlFor={`config-${entry.key}`}>
											{entry.key}
											{entry.required ? (
												<span className="ml-1 text-destructive">*</span>
											) : null}
											{group && !entry.required ? (
												<span className="ml-1 text-xs font-normal text-muted-foreground">
													(or{" "}
													{group.keys.filter((k) => k !== entry.key).join(", ")}
													)
												</span>
											) : null}
										</Label>
										<Input
											id={`config-${entry.key}`}
											value={config[entry.key] ?? ""}
											disabled={superseded}
											onChange={(event) => {
												setConfig((current) => ({
													...current,
													[entry.key]: event.target.value,
												}));
												clearProbeResults();
											}}
											placeholder={entry.envVar}
										/>
									</div>
								);
							})}
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
								onValueChange={(value) => {
									setRegion(value === ANY_REGION ? "" : value);
									clearProbeResults();
								}}
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

					<div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm font-medium">Allowed models</p>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										setAllowedModels((current) =>
											Array.from(new Set([...current, ...availableModels])),
										);
										clearVerifyResults();
									}}
									disabled={
										availableModels.length === 0 || allAvailableModelsSelected
									}
									title="Explicitly selects every catalogue model so they can all be tested."
								>
									<CheckCheck />
									{availableModels.length === 0
										? "No models available"
										: allAvailableModelsSelected
											? `All ${availableModels.length} selected`
											: `Select all ${availableModels.length}`}
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={availableModels.length === 0}
											title="Replace the restriction with one model type."
										>
											Select by kind
											<ChevronDown />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="z-[60] min-w-52">
										{PROVIDER_MODEL_KINDS.map((kind) => (
											<DropdownMenuItem
												key={kind}
												disabled={modelsByKind[kind].length === 0}
												onSelect={() => {
													setAllowedModels([...modelsByKind[kind]]);
													clearVerifyResults();
												}}
											>
												Only {MODEL_KIND_LABELS[kind].toLowerCase()}
												<DropdownMenuShortcut>
													{modelsByKind[kind].length}
												</DropdownMenuShortcut>
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
								<PasteAllowedModelsDialog
									availableIds={availableModels}
									providerName={selectedEntry?.name ?? "this provider"}
									value={allowedModels}
									onChange={(next) => {
										setAllowedModels(next);
										clearVerifyResults();
									}}
								/>
							</div>
						</div>
						<MultiModelIdSelector
							availableIds={availableModels}
							value={allowedModels}
							onChange={(next) => {
								setAllowedModels(next);
								// A changed list invalidates the last verification report.
								clearVerifyResults();
							}}
							placeholder="All models (no restriction)"
						/>
						<p className="text-xs text-muted-foreground">
							{allowedModels.length === 0
								? "Empty means the key serves every model of the provider. Restrict it when the upstream account only has some models enabled, so routing never picks this key for a model it cannot serve."
								: `Routing will only use this credential for the ${allowedModels.length === 1 ? "listed model" : `${allowedModels.length} listed models`}.`}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleSelfTest}
								disabled={
									selfTestLoading ||
									verifyLoading ||
									!provider ||
									(!isEdit && !token)
								}
								title="Sends one minimal request through the key using the provider's default validation model, without saving anything."
								aria-busy={selfTestLoading}
							>
								{selfTestLoading ? (
									<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
								) : null}
								Self-test key
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleVerifyModels}
								disabled={
									selfTestLoading ||
									verifyLoading ||
									allowedModels.length === 0 ||
									!provider ||
									(!isEdit && !token)
								}
								title="Probes supported model types through the key and reports which ones the account can actually serve. Video generation is skipped."
								aria-busy={verifyLoading}
							>
								{verifyLoading ? (
									<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
								) : null}
								{allowedModels.length === 0
									? "No models selected"
									: exactAvailableModelSelection
										? `Test all ${allowedModels.length} models`
										: `Test ${allowedModels.length} selected model${allowedModels.length === 1 ? "" : "s"}`}
							</Button>
						</div>
						{/* Live region so the async probe results are announced to
						    assistive technology when they arrive. empty:hidden keeps the
						    parent's gap from rendering around it before any result. */}
						<div
							aria-live="polite"
							className="flex flex-col gap-3 empty:hidden"
						>
							{selfTestOutcome ? (
								selfTestOutcome.error || !selfTestOutcome.result?.valid ? (
									<p className="text-sm text-destructive">
										Self-test failed
										{selfTestOutcome.result?.model
											? ` (probed ${selfTestOutcome.result.model})`
											: ""}
										: {selfTestFailureReason(selfTestOutcome)}
									</p>
								) : (
									<p className="flex items-center gap-1 text-sm text-green-600">
										<CheckCircle2 className="h-4 w-4" />
										Key works
										{selfTestOutcome.result?.model
											? ` — probed ${selfTestOutcome.result.model}`
											: ""}
										.
									</p>
								)
							) : null}
							{verifyOutcome?.error ? (
								<p className="text-sm text-destructive">
									{verifyOutcome.error}
								</p>
							) : null}
							{verifyOutcome?.result ? (
								<ModelVerificationReport
									verification={verifyOutcome.result}
									onUseSuccessfulModels={(models) => {
										setAllowedModels(models);
										clearVerifyResults();
										toast.success(
											`${models.length} successful model${models.length === 1 ? "" : "s"} selected`,
										);
									}}
								/>
							) : null}
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="usage-limit">Max spend (USD)</Label>
						<div className="relative">
							<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
								$
							</span>
							<Input
								id="usage-limit"
								className="pl-6"
								value={usageLimit}
								onChange={(event) => setUsageLimit(event.target.value)}
								type="number"
								min={0}
								step="0.01"
								placeholder="No limit"
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Security fuse: once the spend attributed to this credential
							reaches this amount, it is automatically deactivated (with a few
							seconds of lag). Leave empty for no limit.
							{isEdit && credential
								? ` Spent so far: ${formatUsd(credential.usage)}.`
								: ""}
						</p>
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
								confirm it works — against the first allowed model when a
								restriction is set, the provider&apos;s default validation model
								otherwise. Skip it for providers with no chat model to test
								against, or when the upstream is temporarily down.
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
						disabled={
							loading ||
							(!isEdit && (!provider || !token)) ||
							hasUnsatisfiedExclusiveGroup
						}
					>
						{loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
						{isEdit ? "Save" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Status icon for one row of the verify-models report: green = probed and
 * served, red = probed and rejected, gray = listed but not probeable (unknown,
 * models whose request surface is not enabled for verification).
 */
function ModelVerificationIcon({ entry }: { entry: ModelVerificationEntry }) {
	if (entry.valid === true) {
		return (
			<CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-green-600" />
		);
	}
	if (entry.valid === false) {
		return <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />;
	}
	return (
		<MinusCircle className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
	);
}

function ModelVerificationReport({
	verification,
	onUseSuccessfulModels,
}: {
	verification: ProviderCredentialModelVerification;
	onUseSuccessfulModels: (models: string[]) => void;
}) {
	const successfulModels = verification.results
		.filter((entry) => entry.valid === true)
		.map((entry) => entry.model);
	const failedCount = verification.results.filter(
		(entry) => entry.valid === false,
	).length;
	const untestedCount =
		verification.results.length - successfulModels.length - failedCount;
	const hasModelsToRemove = failedCount > 0 || untestedCount > 0;

	return (
		<div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p
					className={cn(
						"text-xs font-medium",
						failedCount > 0
							? "text-destructive"
							: untestedCount > 0
								? "text-muted-foreground"
								: "text-green-600",
					)}
				>
					{successfulModels.length} succeeded · {failedCount} failed ·{" "}
					{untestedCount} not testable
				</p>
				{hasModelsToRemove && successfulModels.length > 0 ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onUseSuccessfulModels(successfulModels)}
						title="Replaces the restriction list with only the models that returned a successful live response."
					>
						<CheckCheck />
						Use {successfulModels.length} successful
					</Button>
				) : null}
			</div>
			<ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
				{verification.results.map((entry) => (
					<li key={entry.model} className="flex items-start gap-1.5 text-xs">
						<ModelVerificationIcon entry={entry} />
						<span className="font-mono">{entry.model}</span>
						{entry.error ? (
							<span className="text-muted-foreground">— {entry.error}</span>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}
