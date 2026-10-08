"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { ProviderDetailResponse } from "@/lib/types";
import type { ReactNode } from "react";

type AirsideCarrier = NonNullable<ProviderDetailResponse["airside"]>;
type AirsideSettings = AirsideCarrier["settings"];

// Staff roles get margin-derived fields stripped from the response.
export function formatPercent(fraction: number | undefined): string {
	if (fraction === undefined) {
		return "—";
	}
	return `${(fraction * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatDate(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "—";
}

export function FareBadge({ adjustment }: { adjustment: number | undefined }) {
	if (adjustment === undefined) {
		return null;
	}
	return (
		<Badge
			variant={
				adjustment < 0
					? "secondary"
					: adjustment > 0
						? "destructive"
						: "outline"
			}
		>
			{adjustment > 0 ? "+" : ""}
			{formatPercent(adjustment)}
		</Badge>
	);
}

function SettingRow({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("min-w-0", className)}>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="break-words text-sm">{children}</dd>
		</div>
	);
}

function readSvgDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
		reader.readAsDataURL(file);
	});
}

// Percent inputs are edited as whole percentages and sent as fractions.
function toFraction(value: string): number | null {
	const percent = Number(value);
	if (value.trim() === "" || !Number.isFinite(percent)) {
		return null;
	}
	return Math.round(percent * 100) / 10000;
}

// null while either input is empty or not a number.
function parseFare(discount: string, margin: string) {
	const discountPercent = toFraction(discount);
	const marginPercent = toFraction(margin);
	return discountPercent === null || marginPercent === null
		? null
		: { discountPercent, marginPercent };
}

function toPercentInput(fraction: number | undefined): string {
	return fraction === undefined
		? ""
		: String(Math.round(fraction * 10000) / 100);
}

function useRefreshOnSuccess(message: string) {
	const router = useRouter();
	return {
		onSuccess: () => {
			toast.success(message);
			router.refresh();
		},
		onError: (error: unknown) => {
			toast.error(apiErrorMessage(error, "The change failed"));
		},
	};
}

type BrandingField = "logoUrl" | "iconUrl";

function EditDetailsDialog({
	open,
	onOpenChange,
	carrier,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	carrier: AirsideCarrier;
}) {
	const $api = useApi();
	const router = useRouter();
	const { settings } = carrier;
	const isCustom = carrier.claimKind === "custom";
	const [name, setName] = useState(settings.customName ?? "");
	const [baseUrl, setBaseUrl] = useState(settings.customBaseUrl ?? "");
	const [description, setDescription] = useState(
		settings.customDescription ?? "",
	);
	const [website, setWebsite] = useState(settings.companyWebsite ?? "");
	// undefined = unchanged, null = cleared.
	const [images, setImages] = useState<
		Partial<Record<BrandingField, string | null>>
	>({});

	const claimMutation = $api.useMutation(
		"patch",
		"/admin/airside/claims/{id}/settings",
	);
	const companyMutation = $api.useMutation(
		"patch",
		"/admin/airside/companies/{id}",
	);
	const saving = claimMutation.isPending || companyMutation.isPending;

	async function save() {
		const trimmedName = name.trim();
		const body = {
			...(trimmedName && trimmedName !== (settings.customName ?? "")
				? { name: trimmedName }
				: {}),
			...(baseUrl.trim() && baseUrl.trim() !== (settings.customBaseUrl ?? "")
				? { baseUrl: baseUrl.trim() }
				: {}),
			...(isCustom && description !== (settings.customDescription ?? "")
				? { description: description.trim() || null }
				: {}),
			...images,
		};
		const nextWebsite = website.trim() || null;
		try {
			if (Object.keys(body).length > 0) {
				await claimMutation.mutateAsync({
					params: { path: { id: settings.claimId } },
					body,
				});
			}
			if (nextWebsite !== settings.companyWebsite) {
				await companyMutation.mutateAsync({
					params: { path: { id: carrier.company.id } },
					body: { website: nextWebsite },
				});
			}
			toast.success("Carrier settings saved.");
			onOpenChange(false);
			router.refresh();
		} catch (error) {
			toast.error(apiErrorMessage(error, "The change failed"));
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg" aria-describedby={undefined}>
				<DialogHeader>
					<DialogTitle>Edit carrier details</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1">
						<Label htmlFor="airside-name">Display name</Label>
						<Input
							id="airside-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="airside-base-url">Base URL</Label>
						<Input
							id="airside-base-url"
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
						/>
						{!isCustom && (
							<p className="text-xs text-muted-foreground">
								Used after the static provider definition is removed.
							</p>
						)}
					</div>
					{isCustom && (
						<div className="space-y-1">
							<Label htmlFor="airside-description">Description</Label>
							<Textarea
								id="airside-description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
							/>
						</div>
					)}
					<div className="space-y-1">
						<Label htmlFor="airside-website">Company website</Label>
						<Input
							id="airside-website"
							value={website}
							onChange={(e) => setWebsite(e.target.value)}
						/>
					</div>
					{(["logoUrl", "iconUrl"] as const).map((field) => {
						const current =
							images[field] === undefined ? settings[field] : images[field];
						return (
							<div key={field} className="space-y-1">
								<Label htmlFor={`airside-${field}`}>
									{field === "logoUrl" ? "Logo" : "Icon"} (SVG)
								</Label>
								<div className="flex items-center gap-2">
									{current ? (
										<img
											src={current}
											alt=""
											className="h-8 max-w-24 rounded bg-white object-contain"
										/>
									) : (
										<span className="text-xs text-muted-foreground">none</span>
									)}
									<Input
										id={`airside-${field}`}
										type="file"
										accept="image/svg+xml"
										className="max-w-56"
										onChange={async (e) => {
											const file = e.target.files?.[0];
											if (!file) {
												return;
											}
											try {
												const dataUrl = await readSvgDataUrl(file);
												setImages((prev) => ({ ...prev, [field]: dataUrl }));
											} catch {
												toast.error("Could not read the image file.");
											}
										}}
									/>
									{current ? (
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() =>
												setImages((prev) => ({ ...prev, [field]: null }))
											}
										>
											Clear
										</Button>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={saving} onClick={() => void save()}>
						{saving ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function TestKeyEditor({ settings }: { settings: AirsideSettings }) {
	const $api = useApi();
	const [apiKey, setApiKey] = useState("");
	const saveKey = $api.useMutation(
		"put",
		"/admin/airside/claims/{id}/verification-key",
		useRefreshOnSuccess("Test key saved."),
	);
	const removeKey = $api.useMutation(
		"delete",
		"/admin/airside/claims/{id}/verification-key",
		useRefreshOnSuccess("Test key removed."),
	);
	const path = { path: { id: settings.claimId } };

	return (
		<form
			className="mt-2 flex max-w-md gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				saveKey.mutate(
					{ params: path, body: { apiKey } },
					{ onSuccess: () => setApiKey("") },
				);
			}}
		>
			<Input
				type="password"
				autoComplete="off"
				aria-label="Test key"
				placeholder={
					settings.verificationKeyMasked ? "New key to replace it" : "Test key"
				}
				value={apiKey}
				onChange={(e) => setApiKey(e.target.value)}
			/>
			<Button
				type="submit"
				size="sm"
				disabled={!apiKey.trim() || saveKey.isPending}
			>
				{settings.verificationKeyMasked ? "Replace" : "Save"}
			</Button>
			{settings.verificationKeyMasked ? (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={removeKey.isPending}
					onClick={() => removeKey.mutate({ params: path })}
				>
					Remove
				</Button>
			) : null}
		</form>
	);
}

function FareRow({
	providerId,
	modelId,
	discountPercent,
	marginPercent,
	routingAdjustment,
	updatedAt,
	editable,
}: {
	providerId: string;
	modelId: string | null;
	discountPercent: number;
	marginPercent: number | undefined;
	routingAdjustment: number | undefined;
	updatedAt: string | null;
	editable: boolean;
}) {
	const $api = useApi();
	const [editing, setEditing] = useState(false);
	const [discount, setDiscount] = useState(toPercentInput(discountPercent));
	const [margin, setMargin] = useState(toPercentInput(marginPercent));
	const setFare = $api.useMutation(
		"put",
		"/admin/airside/routing-settings/{providerId}",
		useRefreshOnSuccess("Fare updated."),
	);
	const fare = parseFare(discount, margin);
	const removeOverride = $api.useMutation(
		"delete",
		"/admin/airside/routing-settings/{providerId}/override",
		useRefreshOnSuccess("Override removed."),
	);

	return (
		<tr className="border-t border-border/60">
			<td className="py-1 font-mono text-xs">{modelId ?? "default"}</td>
			{editing ? (
				<>
					<td className="py-1">
						<Input
							type="number"
							step="0.5"
							aria-label="Discount %"
							className="h-7 w-20"
							value={discount}
							onChange={(e) => setDiscount(e.target.value)}
						/>
					</td>
					<td className="py-1">
						<Input
							type="number"
							step="0.5"
							aria-label="Margin %"
							className="h-7 w-20"
							value={margin}
							onChange={(e) => setMargin(e.target.value)}
						/>
					</td>
					<td />
					<td />
					<td className="py-1 text-right">
						<div className="flex justify-end gap-1">
							<Button
								size="sm"
								className="h-7"
								disabled={!fare || setFare.isPending}
								onClick={() => {
									if (fare) {
										setFare.mutate(
											{
												params: { path: { providerId } },
												body: { modelId, ...fare },
											},
											{ onSuccess: () => setEditing(false) },
										);
									}
								}}
							>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								className="h-7"
								onClick={() => setEditing(false)}
							>
								Cancel
							</Button>
						</div>
					</td>
				</>
			) : (
				<>
					<td className="py-1 tabular-nums">
						{formatPercent(discountPercent)}
					</td>
					<td className="py-1 tabular-nums">{formatPercent(marginPercent)}</td>
					<td className="py-1">
						<FareBadge adjustment={routingAdjustment} />
					</td>
					<td className="py-1">{formatDate(updatedAt)}</td>
					<td className="py-1 text-right">
						{editable ? (
							<div className="flex justify-end gap-1">
								<Button
									size="sm"
									variant="outline"
									className="h-7"
									onClick={() => {
										setDiscount(toPercentInput(discountPercent));
										setMargin(toPercentInput(marginPercent));
										setEditing(true);
									}}
								>
									Edit
								</Button>
								{modelId ? (
									<Button
										size="sm"
										variant="ghost"
										className="h-7"
										disabled={removeOverride.isPending}
										onClick={() =>
											removeOverride.mutate({
												params: { path: { providerId }, query: { modelId } },
											})
										}
									>
										Remove
									</Button>
								) : null}
							</div>
						) : null}
					</td>
				</>
			)}
		</tr>
	);
}

function AddOverrideForm({
	providerId,
	models,
	defaults,
}: {
	providerId: string;
	models: string[];
	defaults: { discountPercent: number; marginPercent: number | undefined };
}) {
	const $api = useApi();
	const [modelId, setModelId] = useState("");
	const [discount, setDiscount] = useState(
		toPercentInput(defaults.discountPercent),
	);
	const [margin, setMargin] = useState(toPercentInput(defaults.marginPercent));
	const setFare = $api.useMutation(
		"put",
		"/admin/airside/routing-settings/{providerId}",
		useRefreshOnSuccess("Override added."),
	);
	const fare = parseFare(discount, margin);

	if (models.length === 0) {
		return null;
	}
	return (
		<form
			className="mt-3 flex flex-wrap items-end gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (fare) {
					setFare.mutate(
						{
							params: { path: { providerId } },
							body: { modelId, ...fare },
						},
						{ onSuccess: () => setModelId("") },
					);
				}
			}}
		>
			<div className="space-y-1">
				<Label className="text-xs">Model</Label>
				<Select value={modelId} onValueChange={setModelId}>
					<SelectTrigger className="h-8 w-64">
						<SelectValue placeholder="Select a model" />
					</SelectTrigger>
					<SelectContent>
						{models.map((m) => (
							<SelectItem key={m} value={m}>
								{m}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1">
				<Label htmlFor="override-discount" className="text-xs">
					Discount %
				</Label>
				<Input
					id="override-discount"
					type="number"
					step="0.5"
					className="h-8 w-20"
					value={discount}
					onChange={(e) => setDiscount(e.target.value)}
				/>
			</div>
			<div className="space-y-1">
				<Label htmlFor="override-margin" className="text-xs">
					Margin %
				</Label>
				<Input
					id="override-margin"
					type="number"
					step="0.5"
					className="h-8 w-20"
					value={margin}
					onChange={(e) => setMargin(e.target.value)}
				/>
			</div>
			<Button
				type="submit"
				size="sm"
				disabled={!modelId || !fare || setFare.isPending}
			>
				Add override
			</Button>
		</form>
	);
}

function PendingFilingActions({ filingId }: { filingId: string }) {
	const $api = useApi();
	const path = { path: { id: filingId } };
	const approve = $api.useMutation(
		"post",
		"/admin/airside/routing-filings/{id}/approve",
		useRefreshOnSuccess("Fare filing approved."),
	);
	const reject = $api.useMutation(
		"post",
		"/admin/airside/routing-filings/{id}/reject",
		useRefreshOnSuccess("Fare filing rejected."),
	);
	const busy = approve.isPending || reject.isPending;
	return (
		<>
			<Button
				size="sm"
				className="h-7"
				disabled={busy}
				onClick={() => approve.mutate({ params: path })}
			>
				Approve
			</Button>
			<Button
				size="sm"
				variant="outline"
				className="h-7"
				disabled={busy}
				onClick={() => reject.mutate({ params: path, body: {} })}
			>
				Reject
			</Button>
		</>
	);
}

function PendingBrandingActions({ claimId }: { claimId: string }) {
	const $api = useApi();
	const path = { path: { id: claimId } };
	const approve = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/branding/approve",
		useRefreshOnSuccess("Branding change approved."),
	);
	const reject = $api.useMutation(
		"post",
		"/admin/airside/claims/{id}/branding/reject",
		useRefreshOnSuccess("Branding change rejected."),
	);
	const busy = approve.isPending || reject.isPending;
	return (
		<>
			<Button
				size="sm"
				variant="outline"
				className="h-6 px-2 text-xs"
				disabled={busy}
				onClick={() => approve.mutate({ params: path })}
			>
				Approve
			</Button>
			<Button
				size="sm"
				variant="ghost"
				className="h-6 px-2 text-xs"
				disabled={busy}
				onClick={() => reject.mutate({ params: path })}
			>
				Reject
			</Button>
		</>
	);
}

export function AirsideSettingsSection({
	providerId,
	carrier,
}: {
	providerId: string;
	carrier: AirsideCarrier;
}) {
	const editable = canWrite(useAdminRole());
	const [editOpen, setEditOpen] = useState(false);
	const { settings } = carrier;
	const overridden = new Set(settings.modelOverrides.map((o) => o.modelId));
	const overrideCandidates = settings.listedModels.filter(
		(m) => !overridden.has(m),
	);

	return (
		<section className="space-y-4" data-testid="provider-airside-settings">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-xl font-semibold">Airside settings</h2>
				{editable ? (
					<Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
						Edit details
					</Button>
				) : null}
			</div>
			{editOpen ? (
				<EditDetailsDialog
					open={editOpen}
					onOpenChange={setEditOpen}
					carrier={carrier}
				/>
			) : null}
			<div className="space-y-6 rounded-lg border border-border/60 bg-card p-4">
				<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<SettingRow label="Display name">
						{settings.customName ?? "—"}
					</SettingRow>
					<SettingRow label="Base URL">
						<span className="font-mono text-xs">
							{settings.customBaseUrl ?? "—"}
						</span>
					</SettingRow>
					<SettingRow label="Matched domain">
						{settings.matchedDomain}
					</SettingRow>
					<SettingRow label="Company website">
						{settings.companyWebsite ?? "—"}
					</SettingRow>
					<SettingRow label="Listing fee">
						<Badge
							variant={
								settings.paymentStatus === "paid" ? "secondary" : "outline"
							}
						>
							{settings.paymentStatus}
						</Badge>
						{settings.listingInviteCode ? (
							<span className="ml-2 text-xs text-muted-foreground">
								waived via {settings.listingInviteCode}
							</span>
						) : settings.paidAt ? (
							<span className="ml-2 text-xs text-muted-foreground">
								{formatDate(settings.paidAt)}
							</span>
						) : null}
					</SettingRow>
					<SettingRow label="Claimed">
						{formatDate(settings.claimedAt)}
					</SettingRow>
					<SettingRow label="Approved">
						{formatDate(settings.approvedAt)}
					</SettingRow>
					<SettingRow label="Domains">
						{settings.domains.length === 0
							? "—"
							: settings.domains.map((d) => (
									<span
										key={`${d.domain}-${d.verificationMethod}`}
										className="block"
									>
										{d.domain}{" "}
										<span className="text-xs text-muted-foreground">
											{d.verificationMethod} ·{" "}
											{d.verifiedAt ? "verified" : "unverified"}
										</span>
									</span>
								))}
					</SettingRow>
					<SettingRow label="Branding" className="sm:col-span-2">
						<div className="flex flex-wrap items-center gap-2">
							{(["logoUrl", "iconUrl"] as const).map((field) =>
								settings[field] ? (
									<img
										key={field}
										src={settings[field] ?? undefined}
										alt={field === "logoUrl" ? "Logo" : "Icon"}
										className="h-8 max-w-24 rounded bg-white object-contain"
									/>
								) : null,
							)}
							{!settings.logoUrl && !settings.iconUrl ? "—" : null}
							{settings.hasPendingBranding ? (
								<>
									<Badge variant="outline">change pending</Badge>
									{editable ? (
										<PendingBrandingActions claimId={settings.claimId} />
									) : null}
								</>
							) : null}
						</div>
					</SettingRow>
				</dl>
				{settings.customDescription ? (
					<SettingRow label="Description">
						<p className="whitespace-pre-wrap">{settings.customDescription}</p>
					</SettingRow>
				) : null}
				<div>
					<h3 className="text-sm font-semibold">Test key</h3>
					<p className="text-sm">
						{settings.verificationKeyMasked ? (
							<>
								<span className="font-mono text-xs">
									{settings.verificationKeyMasked}
								</span>{" "}
								<span className="text-xs text-muted-foreground">
									saved {formatDate(settings.verificationKeyUpdatedAt)}
								</span>
							</>
						) : (
							<span className="text-muted-foreground">Not set</span>
						)}
					</p>
					{editable ? <TestKeyEditor settings={settings} /> : null}
				</div>
				<div>
					<h3 className="text-sm font-semibold">Fares</h3>
					<table className="mt-2 w-full text-sm">
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th className="py-1 font-normal">Scope</th>
								<th className="py-1 font-normal">Discount</th>
								<th className="py-1 font-normal">Margin</th>
								<th className="py-1 font-normal">Routing adjustment</th>
								<th className="py-1 font-normal">Updated</th>
								<th />
							</tr>
						</thead>
						<tbody>
							<FareRow
								providerId={providerId}
								modelId={null}
								discountPercent={carrier.discountPercent}
								marginPercent={carrier.marginPercent}
								routingAdjustment={carrier.routingAdjustment}
								updatedAt={carrier.settingsUpdatedAt}
								editable={editable}
							/>
							{settings.modelOverrides.map((o) => (
								<FareRow
									key={o.modelId}
									providerId={providerId}
									modelId={o.modelId}
									discountPercent={o.discountPercent}
									marginPercent={o.marginPercent}
									routingAdjustment={o.routingAdjustment}
									updatedAt={o.updatedAt}
									editable={editable}
								/>
							))}
						</tbody>
					</table>
					{editable ? (
						<AddOverrideForm
							providerId={providerId}
							models={overrideCandidates}
							defaults={carrier}
						/>
					) : null}
				</div>
				<div>
					<h3 className="text-sm font-semibold">Pending fare filings</h3>
					{settings.pendingFilings.length === 0 ? (
						<p className="text-sm text-muted-foreground">None.</p>
					) : (
						<ul className="mt-2 space-y-1 text-sm">
							{settings.pendingFilings.map((f) => (
								<li key={f.id} className="flex flex-wrap items-center gap-2">
									<span className="font-mono text-xs">
										{f.modelId ?? "default"}
									</span>
									<span className="tabular-nums">
										discount {formatPercent(f.discountPercent)} · margin{" "}
										{formatPercent(f.marginPercent)}
									</span>
									<FareBadge adjustment={f.routingAdjustment} />
									<span className="text-xs text-muted-foreground">
										filed {formatDate(f.createdAt)}
									</span>
									{editable ? <PendingFilingActions filingId={f.id} /> : null}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	);
}
