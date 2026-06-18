"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/lib/components/alert-dialog";
import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";
import { Textarea } from "@/lib/components/textarea";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { Project } from "@/lib/types";

interface SdkSettingsProps {
	initialProject: Project;
	orgId: string;
	projectId: string;
}

function normalizeOrigins(value: string) {
	const origins = value
		.split(/\r?\n/)
		.map((origin) => origin.trim())
		.filter(Boolean);
	const normalizedOrigins = new Set<string>();

	for (const origin of origins) {
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new Error(`Invalid allowed origin: ${origin}`);
		}

		if (url.protocol !== "https:" && url.protocol !== "http:") {
			throw new Error("Origins must use http or https.");
		}
		normalizedOrigins.add(url.origin);
	}

	return Array.from(normalizedOrigins);
}

function getErrorMessage(error: unknown, fallback: string) {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	if (typeof error !== "object" || error === null) {
		return fallback;
	}

	const record = error as Record<string, unknown>;
	if (typeof record.message === "string" && record.message) {
		return record.message;
	}

	if (typeof record.error === "string" && record.error) {
		return record.error;
	}

	if (typeof record.data === "object" && record.data !== null) {
		const data = record.data as Record<string, unknown>;
		if (typeof data.message === "string" && data.message) {
			return data.message;
		}
	}

	return fallback;
}

export function SdkSettings({
	initialProject,
	orgId,
	projectId,
}: SdkSettingsProps) {
	const { toast } = useToast();
	const api = useApi();
	const queryClient = useQueryClient();
	// The Payments SDK is a preview feature that must be opted into in the
	// database. Until then, the settings are shown read-only as a preview.
	const isPreview = !initialProject.paymentsSdkEnabled;
	const [endUserEnabled, setEndUserEnabled] = useState(
		initialProject.endUserEnabled,
	);
	const [markupPercent, setMarkupPercent] = useState(
		Number(initialProject.endUserMarkupPercent ?? "0"),
	);
	const [allowedOriginsText, setAllowedOriginsText] = useState(
		(initialProject.allowedOrigins ?? []).join("\n"),
	);
	const [createdToken, setCreatedToken] = useState("");

	const platformKeysQuery = api.useQuery(
		"get",
		"/keys/platform",
		{
			params: {
				query: {
					projectId,
				},
			},
		},
		{
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);

	const updateProject = api.useMutation("patch", "/projects/{id}");
	const createPlatformKey = api.useMutation("post", "/keys/platform");
	const deletePlatformKey = api.useMutation("delete", "/keys/platform/{id}");

	const projectQueryKey = api.queryOptions("get", "/orgs/{id}/projects", {
		params: { path: { id: orgId } },
	}).queryKey;
	const platformKeysQueryKey = api.queryOptions("get", "/keys/platform", {
		params: { query: { projectId } },
	}).queryKey;

	const platformKeys = useMemo(
		() => platformKeysQuery.data?.platformKeys ?? [],
		[platformKeysQuery.data],
	);
	const platformKeysError = platformKeysQuery.error as unknown;
	const platformKeysErrorMessage = getErrorMessage(
		platformKeysError,
		"Failed to load platform secret keys.",
	);

	const saveSettings = async () => {
		let allowedOrigins: string[];
		try {
			allowedOrigins = normalizeOrigins(allowedOriginsText);
		} catch (error) {
			toast({
				title: "Invalid allowed origin",
				description:
					error instanceof Error
						? error.message
						: "Enter one valid origin per line.",
				variant: "destructive",
			});
			return;
		}

		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: {
					endUserEnabled,
					endUserMarkupPercent: markupPercent,
					allowedOrigins,
				},
			});
			setAllowedOriginsText(allowedOrigins.join("\n"));
			await queryClient.invalidateQueries({
				queryKey: projectQueryKey,
			});
			toast({
				title: "Settings saved",
				description: "SDK project settings have been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save SDK settings.",
				variant: "destructive",
			});
		}
	};

	const createSecret = async (test: boolean) => {
		try {
			const response = await createPlatformKey.mutateAsync({
				body: {
					projectId,
					description: test ? "SDK test secret" : "SDK platform secret",
					test,
				},
			});
			setCreatedToken(response.platformKey.token);
			await queryClient.invalidateQueries({
				queryKey: platformKeysQueryKey,
			});
			toast({
				title: test ? "Test secret key created" : "Secret key created",
				description: test
					? "Top-ups with this key use the Stripe sandbox. Copy it now — it won't be shown again."
					: "Copy the key now. It will not be shown again.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to create platform secret key.",
				variant: "destructive",
			});
		}
	};

	const deleteSecret = async (id: string) => {
		try {
			await deletePlatformKey.mutateAsync({
				params: { path: { id } },
			});
			await queryClient.invalidateQueries({
				queryKey: platformKeysQueryKey,
			});
			toast({
				title: "Secret key revoked",
				description: "The platform secret key has been revoked.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to revoke platform secret key.",
				variant: "destructive",
			});
		}
	};

	const copyCreatedToken = async () => {
		try {
			await navigator.clipboard.writeText(createdToken);
			toast({
				title: "Secret key copied",
				description: "The platform secret key has been copied.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to copy platform secret key.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-8">
			{isPreview && (
				<div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
					<p className="font-medium text-blue-900 dark:text-blue-200">
						Preview — opt-in only
					</p>
					<p className="mt-1 text-sm text-blue-900/80 dark:text-blue-200/80">
						The Payments SDK lets you embed end-user payments and sessions into
						your own site — your users get their own wallet, buy credits, and
						pay per request through LLM Gateway. It is a payments feature, not
						an AI client SDK like the OpenAI SDK. This feature is currently in
						preview and enabled on an opt-in basis. The settings below are
						read-only until it is enabled for your project — contact us to get
						access.
					</p>
				</div>
			)}
			<section className="space-y-4">
				<div>
					<h3 className="text-lg font-medium">End-user Sessions</h3>
					<p className="text-muted-foreground text-sm">
						Project: {initialProject.name}
					</p>
				</div>
				<Separator />
				<div className="space-y-5">
					<div className="flex items-start gap-3">
						<Switch
							checked={endUserEnabled}
							onCheckedChange={setEndUserEnabled}
							disabled={isPreview}
							aria-label="Enable end-user sessions"
						/>
						<div className="space-y-1">
							<Label>Enable end-user sessions</Label>
							<p className="text-muted-foreground text-sm">
								Allow this project to mint short-lived browser session tokens.
							</p>
						</div>
					</div>
					<div className="grid gap-2 sm:max-w-56">
						<Label htmlFor="markupPercent">Markup percent</Label>
						<Input
							id="markupPercent"
							type="number"
							min={0}
							max={100}
							step={0.01}
							value={markupPercent}
							disabled={isPreview}
							onChange={(event) => setMarkupPercent(Number(event.target.value))}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="allowedOrigins">Allowed origins</Label>
						<Textarea
							id="allowedOrigins"
							value={allowedOriginsText}
							onChange={(event) => setAllowedOriginsText(event.target.value)}
							placeholder="https://app.example.com"
							disabled={isPreview}
							className="min-h-28 font-mono text-sm"
						/>
						<p className="text-muted-foreground text-sm">
							One browser origin per line.
						</p>
					</div>
					<div className="flex justify-end">
						<Button
							type="button"
							onClick={saveSettings}
							disabled={isPreview || updateProject.isPending}
						>
							{updateProject.isPending ? "Saving..." : "Save Settings"}
						</Button>
					</div>
				</div>
			</section>

			<section className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h3 className="text-lg font-medium">Platform Secret Keys</h3>
						<p className="text-muted-foreground text-sm">
							Server-side keys for minting end-user sessions.
						</p>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button
							type="button"
							variant="outline"
							onClick={() => void createSecret(true)}
							disabled={isPreview || createPlatformKey.isPending}
						>
							<KeyRound className="h-4 w-4" />
							Create Test Key
						</Button>
						<Button
							type="button"
							onClick={() => void createSecret(false)}
							disabled={isPreview || createPlatformKey.isPending}
						>
							<KeyRound className="h-4 w-4" />
							{createPlatformKey.isPending ? "Creating..." : "Create Live Key"}
						</Button>
					</div>
				</div>
				<Separator />

				{createdToken && (
					<div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
						<Label htmlFor="createdPlatformToken">New secret key</Label>
						<div className="mt-2 flex gap-2">
							<Input
								id="createdPlatformToken"
								value={createdToken}
								readOnly
								className="font-mono text-xs"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={() => void copyCreatedToken()}
							>
								<Copy className="h-4 w-4" />
								<span className="sr-only">Copy secret key</span>
							</Button>
						</div>
						<p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
							Copy this key now. It will not be shown again.
						</p>
					</div>
				)}

				<div className="space-y-3">
					{platformKeysQuery.isLoading && (
						<p className="text-muted-foreground text-sm">Loading keys...</p>
					)}
					{platformKeysError ? (
						<p className="text-destructive text-sm">
							{platformKeysErrorMessage}
						</p>
					) : null}
					{!platformKeysQuery.isLoading &&
						!platformKeysError &&
						platformKeys.length === 0 && (
							<p className="text-muted-foreground text-sm">
								No platform secret keys yet.
							</p>
						)}
					{platformKeys.map((platformKey) => (
						<div
							key={platformKey.id}
							className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0 space-y-1">
								<div className="flex items-center gap-2">
									<p className="font-medium">{platformKey.description}</p>
									{platformKey.mode === "test" && (
										<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
											test
										</span>
									)}
									<span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
										{platformKey.status}
									</span>
								</div>
								<p className="font-mono text-xs text-muted-foreground">
									{platformKey.maskedToken}
								</p>
							</div>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="outline" size="sm">
										<Trash2 className="h-4 w-4" />
										Revoke
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Revoke secret key?</AlertDialogTitle>
										<AlertDialogDescription>
											Backends using this key will stop minting end-user
											sessions immediately.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => void deleteSecret(platformKey.id)}
										>
											Revoke Key
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
