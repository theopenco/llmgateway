"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Copy,
	Download,
	ExternalLink,
	ImagePlus,
	KeyRound,
	RefreshCw,
	Trash2,
	TriangleAlert,
	UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type ListResponse =
	paths["/portraits"]["get"]["responses"][200]["content"]["application/json"];
type Portrait = ListResponse["portraits"][number];
type PortraitAsset = Portrait["assets"][number];
type ByokKey = ListResponse["byokKeys"][number];
type AssetType = PortraitAsset["assetType"];

const PLATFORM = "__platform__";
const LIST_KEY = ["get", "/portraits"];

function errorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "Something went wrong";
}

function useInvalidatePortraits() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: LIST_KEY });
}

async function copyText(value: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast({ title: "Copied" });
	} catch (error) {
		toast({
			title: "Could not copy",
			description: errorMessage(error),
			variant: "destructive",
		});
	}
}

function Field({
	id,
	label,
	value,
	onChange,
	placeholder,
	type = "text",
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type={type}
				value={value}
				placeholder={placeholder}
				autoComplete="off"
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

function CredentialsDialog({
	organizationId,
	byokKey,
}: {
	organizationId: string;
	byokKey: ByokKey;
}) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const [open, setOpen] = useState(false);
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");
	const [projectName, setProjectName] = useState(
		byokKey.projectName ?? "default",
	);
	const [region, setRegion] = useState(byokKey.region ?? "ap-southeast-1");
	const save = api.useMutation("put", "/portraits/credentials/{providerKeyId}");

	const submit = async () => {
		try {
			await save.mutateAsync({
				params: { path: { providerKeyId: byokKey.id } },
				body: {
					organizationId,
					accessKeyId,
					secretAccessKey,
					projectName: projectName || undefined,
					region: region || undefined,
				},
			});
			await invalidate();
			setOpen(false);
			setAccessKeyId("");
			setSecretAccessKey("");
			toast({ title: "Access keys saved" });
		} catch (error) {
			toast({
				title: "Could not save access keys",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<KeyRound className="mr-2 h-4 w-4" />
					{byokKey.hasAssetCredentials ? "Replace" : "Set access keys"}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>BytePlus access keys</DialogTitle>
					<DialogDescription>
						An IAM access key pair from the same BytePlus account as the API key
						of {byokKey.label}. Stored encrypted.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<Field
						id="ak-id"
						label="Access Key ID"
						value={accessKeyId}
						onChange={setAccessKeyId}
					/>
					<Field
						id="ak-secret"
						label="Secret Access Key"
						type="password"
						value={secretAccessKey}
						onChange={setSecretAccessKey}
					/>
					<Field
						id="ak-project"
						label="Project name"
						value={projectName}
						onChange={setProjectName}
						placeholder="default"
					/>
					<Field
						id="ak-region"
						label="Region"
						value={region}
						onChange={setRegion}
						placeholder="ap-southeast-1"
					/>
				</div>
				<DialogFooter>
					<Button
						onClick={submit}
						disabled={!accessKeyId || !secretAccessKey || save.isPending}
					>
						{save.isPending ? "Saving..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ByokKeyRow({
	organizationId,
	byokKey,
}: {
	organizationId: string;
	byokKey: ByokKey;
}) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const remove = api.useMutation(
		"delete",
		"/portraits/credentials/{providerKeyId}",
	);

	const onRemove = async () => {
		if (
			!window.confirm(
				`Remove the BytePlus access keys from ${byokKey.label}? Portraits using this key stop working.`,
			)
		) {
			return;
		}
		try {
			await remove.mutateAsync({
				params: {
					path: { providerKeyId: byokKey.id },
					query: { organizationId },
				},
			});
			await invalidate();
			toast({ title: "Access keys removed" });
		} catch (error) {
			toast({
				title: "Could not remove access keys",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 space-y-1">
				<p className="truncate font-medium">{byokKey.label}</p>
				{byokKey.hasAssetCredentials ? (
					<Badge variant="secondary" className="font-mono">
						{byokKey.accessKeyIdMasked} · {byokKey.projectName}
						{byokKey.region ? ` · ${byokKey.region}` : ""}
					</Badge>
				) : (
					<Badge variant="outline">Not configured</Badge>
				)}
			</div>
			<div className="flex gap-2">
				<CredentialsDialog organizationId={organizationId} byokKey={byokKey} />
				{byokKey.hasAssetCredentials ? (
					<Button
						size="sm"
						variant="ghost"
						onClick={onRemove}
						disabled={remove.isPending}
						aria-label="Remove access keys"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				) : null}
			</div>
		</div>
	);
}

function VerificationLink({ url }: { url: string }) {
	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				Send this link to the person. They open it on their phone and complete
				BytePlus liveness verification; then click Refresh on the portrait.
			</p>
			<div className="flex gap-2">
				<Input readOnly value={url} className="font-mono text-xs" />
				<Button
					variant="outline"
					size="icon"
					onClick={() => copyText(url)}
					aria-label="Copy link"
				>
					<Copy className="h-4 w-4" />
				</Button>
				<Button asChild variant="outline">
					<a href={url} target="_blank" rel="noopener noreferrer">
						<ExternalLink className="mr-2 h-4 w-4" />
						Open
					</a>
				</Button>
			</div>
		</div>
	);
}

function VerifyPersonDialog({
	organizationId,
	platformAvailable,
	byokKeys,
}: {
	organizationId: string;
	platformAvailable: boolean;
	byokKeys: ByokKey[];
}) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const usableKeys = byokKeys.filter((key) => key.hasAssetCredentials);
	const defaultSource = platformAvailable
		? PLATFORM
		: (usableKeys[0]?.id ?? "");
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [source, setSource] = useState(defaultSource);
	const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
	const create = api.useMutation("post", "/portraits");

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setName("");
			setSource(defaultSource);
			setVerificationUrl(null);
		}
	};

	const submit = async () => {
		try {
			const result = await create.mutateAsync({
				body: {
					organizationId,
					name,
					credentialSource: source === PLATFORM ? "platform" : "byok",
					providerKeyId: source === PLATFORM ? undefined : source,
				},
			});
			await invalidate();
			setVerificationUrl(result.verificationUrl);
		} catch (error) {
			toast({
				title: "Could not start verification",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" disabled={!platformAvailable && !usableKeys.length}>
					<UserPlus className="mr-2 h-4 w-4" />
					Verify a person
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Verify a person</DialogTitle>
					<DialogDescription>
						The person verifies once; afterwards you can add their photos,
						videos and voice.
					</DialogDescription>
				</DialogHeader>
				{verificationUrl ? (
					<VerificationLink url={verificationUrl} />
				) : (
					<>
						<div className="space-y-4">
							<Field
								id="portrait-name"
								label="Name"
								value={name}
								onChange={setName}
								placeholder="Jane Doe"
							/>
							<div className="space-y-2">
								<Label>Credentials</Label>
								<Select value={source} onValueChange={setSource}>
									<SelectTrigger aria-label="Credentials">
										<SelectValue placeholder="Choose credentials" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={PLATFORM} disabled={!platformAvailable}>
											LLM Gateway credits
										</SelectItem>
										{usableKeys.map((key) => (
											<SelectItem key={key.id} value={key.id}>
												{key.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<DialogFooter>
							<Button
								onClick={submit}
								disabled={!name.trim() || !source || create.isPending}
							>
								{create.isPending ? "Starting..." : "Start verification"}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ImportAssetDialog({
	organizationId,
	byokKeys,
}: {
	organizationId: string;
	byokKeys: ByokKey[];
}) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const usableKeys = byokKeys.filter((key) => key.hasAssetCredentials);
	const [open, setOpen] = useState(false);
	const [providerKeyId, setProviderKeyId] = useState(usableKeys[0]?.id ?? "");
	const [upstreamAssetId, setUpstreamAssetId] = useState("");
	const [name, setName] = useState("");
	const importAsset = api.useMutation("post", "/portraits/import");

	if (!usableKeys.length) {
		return null;
	}

	const submit = async () => {
		try {
			await importAsset.mutateAsync({
				body: {
					organizationId,
					providerKeyId,
					upstreamAssetId: upstreamAssetId.trim(),
					name: name.trim() || undefined,
				},
			});
			await invalidate();
			setOpen(false);
			setUpstreamAssetId("");
			setName("");
			toast({ title: "Asset imported" });
		} catch (error) {
			toast({
				title: "Could not import asset",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<Download className="mr-2 h-4 w-4" />
					Import existing asset
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Import existing asset</DialogTitle>
					<DialogDescription>
						Register an asset already in your BytePlus account, e.g. one added
						in the ModelArk console.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label>Provider key</Label>
						<Select value={providerKeyId} onValueChange={setProviderKeyId}>
							<SelectTrigger aria-label="Provider key">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{usableKeys.map((key) => (
									<SelectItem key={key.id} value={key.id}>
										{key.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Field
						id="import-asset-id"
						label="Asset ID"
						value={upstreamAssetId}
						onChange={setUpstreamAssetId}
						placeholder="asset-..."
					/>
					<Field
						id="import-name"
						label="Name (optional)"
						value={name}
						onChange={setName}
					/>
				</div>
				<DialogFooter>
					<Button
						onClick={submit}
						disabled={
							!providerKeyId || !upstreamAssetId.trim() || importAsset.isPending
						}
					>
						{importAsset.isPending ? "Importing..." : "Import"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AddAssetDialog({ portrait }: { portrait: Portrait }) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [assetType, setAssetType] = useState<AssetType>("image");
	const [name, setName] = useState("");
	const add = api.useMutation("post", "/portraits/{id}/assets");

	const submit = async () => {
		try {
			await add.mutateAsync({
				params: { path: { id: portrait.id } },
				body: { url: url.trim(), assetType, name: name.trim() || undefined },
			});
			await invalidate();
			setOpen(false);
			setUrl("");
			setName("");
			toast({
				title: "Asset added",
				description: "Click Refresh once BytePlus finishes processing.",
			});
		} catch (error) {
			toast({
				title: "Could not add asset",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<ImagePlus className="mr-2 h-4 w-4" />
					Add asset
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Add asset to {portrait.name}</DialogTitle>
					<DialogDescription>
						Images: a clear, front-facing photo. Videos: 2–30s mp4/mov. Audio:
						2–30s wav/mp3.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<Field
						id="asset-url"
						label="HTTPS URL"
						value={url}
						onChange={setUrl}
						placeholder="https://example.com/photo.jpg"
					/>
					<div className="space-y-2">
						<Label>Type</Label>
						<Select
							value={assetType}
							onValueChange={(value) => setAssetType(value as AssetType)}
						>
							<SelectTrigger aria-label="Type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="image">Image</SelectItem>
								<SelectItem value="video">Video</SelectItem>
								<SelectItem value="audio">Audio</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Field
						id="asset-name"
						label="Name (optional)"
						value={name}
						onChange={setName}
					/>
				</div>
				<DialogFooter>
					<Button
						onClick={submit}
						disabled={!url.trim().startsWith("https://") || add.isPending}
					>
						{add.isPending ? "Adding..." : "Add asset"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function PortraitStatusBadge({ status }: { status: Portrait["status"] }) {
	if (status === "active") {
		return <Badge>Verified</Badge>;
	}
	if (status === "failed") {
		return <Badge variant="destructive">Failed</Badge>;
	}
	return <Badge variant="secondary">Pending verification</Badge>;
}

function AssetStatusBadge({ status }: { status: PortraitAsset["status"] }) {
	if (status === "active") {
		return <Badge>Active</Badge>;
	}
	if (status === "failed") {
		return <Badge variant="destructive">Rejected</Badge>;
	}
	return <Badge variant="secondary">Processing</Badge>;
}

function AssetRow({ asset }: { asset: PortraitAsset }) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const remove = api.useMutation("delete", "/portraits/assets/{assetId}");

	const onDelete = async () => {
		if (!window.confirm(`Delete ${asset.name ?? "this asset"}?`)) {
			return;
		}
		try {
			await remove.mutateAsync({ params: { path: { assetId: asset.id } } });
			await invalidate();
			toast({ title: "Asset deleted" });
		} catch (error) {
			toast({
				title: "Could not delete asset",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-2 rounded-md border p-3">
			<div className="flex items-center justify-between gap-2">
				<p className="min-w-0 truncate text-sm">
					<span className="font-medium">{asset.name ?? "Untitled"}</span>{" "}
					<span className="text-muted-foreground">{asset.assetType}</span>
				</p>
				<div className="flex items-center gap-2">
					<AssetStatusBadge status={asset.status} />
					<Button
						size="icon"
						variant="ghost"
						onClick={onDelete}
						disabled={remove.isPending}
						aria-label="Delete asset"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<button
				type="button"
				onClick={() => copyText(asset.uri)}
				className="flex w-full items-center gap-2 rounded bg-muted px-2 py-1 text-left font-mono text-xs hover:bg-muted/70"
				aria-label="Copy asset URI"
			>
				<span className="min-w-0 flex-1 truncate">{asset.uri}</span>
				<Copy className="h-3 w-3 shrink-0" />
			</button>
			{asset.lastError ? (
				<p className="text-xs text-destructive">{asset.lastError}</p>
			) : null}
		</div>
	);
}

function PortraitCard({
	portrait,
	byokKeys,
}: {
	portrait: Portrait;
	byokKeys: ByokKey[];
}) {
	const api = useApi();
	const invalidate = useInvalidatePortraits();
	const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
	const refresh = api.useMutation("post", "/portraits/{id}/refresh");
	const restart = api.useMutation("post", "/portraits/{id}/verification");
	const remove = api.useMutation("delete", "/portraits/{id}");
	const params = { params: { path: { id: portrait.id } } };
	const credential =
		portrait.credentialSource === "platform"
			? "LLM Gateway"
			: (byokKeys.find((key) => key.id === portrait.providerKeyId)?.label ??
				"Your BytePlus key");

	const onRefresh = async () => {
		try {
			await refresh.mutateAsync(params);
			await invalidate();
		} catch (error) {
			toast({
				title: "Could not refresh",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const onRestart = async () => {
		try {
			const result = await restart.mutateAsync(params);
			await invalidate();
			setVerificationUrl(result.verificationUrl);
		} catch (error) {
			toast({
				title: "Could not create verification link",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const onDelete = async () => {
		const detail =
			portrait.credentialSource === "platform"
				? "This deletes it and its assets from LLM Gateway's BytePlus account."
				: "This only unlinks it; assets stay in your BytePlus account.";
		if (!window.confirm(`Delete ${portrait.name}? ${detail}`)) {
			return;
		}
		try {
			await remove.mutateAsync(params);
			await invalidate();
			toast({ title: "Portrait deleted" });
		} catch (error) {
			toast({
				title: "Could not delete portrait",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	const assets = portrait.assets.filter((asset) => asset.status !== "deleted");

	return (
		<Card>
			<CardHeader className="space-y-1">
				<div className="flex items-start justify-between gap-2">
					<CardTitle className="text-lg">{portrait.name}</CardTitle>
					<PortraitStatusBadge status={portrait.status} />
				</div>
				<CardDescription>{credential}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{portrait.lastError ? (
					<p className="text-sm text-destructive">{portrait.lastError}</p>
				) : null}
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						onClick={onRefresh}
						disabled={refresh.isPending}
					>
						<RefreshCw
							className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
					{portrait.status === "active" ? (
						<AddAssetDialog portrait={portrait} />
					) : (
						<Button
							size="sm"
							variant="outline"
							onClick={onRestart}
							disabled={restart.isPending}
						>
							<ExternalLink className="mr-2 h-4 w-4" />
							New verification link
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						onClick={onDelete}
						disabled={remove.isPending}
					>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</Button>
				</div>
				{verificationUrl && portrait.status !== "active" ? (
					<VerificationLink url={verificationUrl} />
				) : null}
				{assets.length ? (
					<div className="space-y-2">
						{assets.map((asset) => (
							<AssetRow key={asset.id} asset={asset} />
						))}
					</div>
				) : portrait.status === "active" ? (
					<p className="text-sm text-muted-foreground">
						No assets yet. Add a photo, video or voice clip.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

const USAGE_SNIPPET = `POST /v1/videos
{
	"model": "seedance-2-0",
	"prompt": "The person in Image 1 waves at the camera",
	"reference_images": ["asset://<id>"]
}`;

export function PortraitsClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const api = useApi();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const isAdmin = role === "owner" || role === "admin";

	const list = api.useQuery(
		"get",
		"/portraits",
		{ params: { query: { organizationId } } },
		{ enabled: isAdmin },
	);

	const portraits = (list.data?.portraits ?? []).filter(
		(portrait) => portrait.status !== "deleted",
	);
	const byokKeys = list.data?.byokKeys ?? [];
	const platformAvailable = list.data?.platformAvailable === true;

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-8 p-4 pt-6 md:p-8">
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Portraits</h2>
					<p className="text-muted-foreground">
						Verify a real person once, then use their face, voice or footage in
						Seedance 2.x video requests via asset:// references
					</p>
				</div>

				{!isAdmin && teamData ? (
					<Card>
						<CardContent className="p-6 text-sm text-muted-foreground">
							Only organization owners and admins can manage portraits.
						</CardContent>
					</Card>
				) : list.isLoading || !teamData ? (
					<p className="text-sm text-muted-foreground">Loading portraits...</p>
				) : list.isError ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-2 p-10 text-center">
							<TriangleAlert className="h-8 w-8 text-destructive" />
							<p className="font-medium">Could not load portraits</p>
							<p className="max-w-md text-sm text-muted-foreground">
								{errorMessage(list.error)}
							</p>
						</CardContent>
					</Card>
				) : (
					<>
						<section className="space-y-4">
							<div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
								<div>
									<h3 className="text-xl font-semibold tracking-tight">
										People
									</h3>
									<p className="text-sm text-muted-foreground">
										{platformAvailable
											? "Hosted on LLM Gateway credits or your own BytePlus account."
											: "Hosted on your own BytePlus account."}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<ImportAssetDialog
										organizationId={organizationId}
										byokKeys={byokKeys}
									/>
									<VerifyPersonDialog
										organizationId={organizationId}
										platformAvailable={platformAvailable}
										byokKeys={byokKeys}
									/>
								</div>
							</div>
							{portraits.length === 0 ? (
								<Card>
									<CardContent className="p-6 text-sm text-muted-foreground">
										No portraits yet. Verify a person to get started.
									</CardContent>
								</Card>
							) : (
								<div className="grid gap-4 lg:grid-cols-2">
									{portraits.map((portrait) => (
										<PortraitCard
											key={portrait.id}
											portrait={portrait}
											byokKeys={byokKeys}
										/>
									))}
								</div>
							)}
						</section>

						<section className="space-y-4">
							<div>
								<h3 className="text-xl font-semibold tracking-tight">
									Your BytePlus access keys
								</h3>
								<p className="text-sm text-muted-foreground">
									Needed to host portraits on your own ByteDance provider key.
								</p>
							</div>
							{byokKeys.length === 0 ? (
								<Card>
									<CardContent className="p-6 text-sm text-muted-foreground">
										Add a ByteDance provider key first in{" "}
										<Link
											href={`/dashboard/${organizationId}/org/provider-keys`}
											className="underline"
										>
											Provider Keys
										</Link>
										.
									</CardContent>
								</Card>
							) : (
								<div className="space-y-2">
									{byokKeys.map((key) => (
										<ByokKeyRow
											key={key.id}
											organizationId={organizationId}
											byokKey={key}
										/>
									))}
								</div>
							)}
						</section>

						<Card>
							<CardHeader>
								<CardTitle className="text-lg">Usage</CardTitle>
								<CardDescription>
									Reference an active asset by its URI. Images are numbered in
									order, so the prompt can say &quot;Image 1&quot;.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs">
									{USAGE_SNIPPET}
								</pre>
							</CardContent>
						</Card>
					</>
				)}
			</div>
		</div>
	);
}
