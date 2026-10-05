"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, PlaneTakeoff, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCompany } from "@/components/dashboard/company-context";
import { RelativeDate } from "@/components/RelativeDate";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/fetch-client";

import type { AirsideCompany } from "@/components/dashboard/company-context";

type Claim = AirsideCompany["claims"][number];

function useInvalidateCompanies() {
	const api = useApi();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
		});
}

function VerificationKeyCard({ claim }: { claim: Claim }) {
	const api = useApi();
	const invalidate = useInvalidateCompanies();
	const [apiKey, setApiKey] = useState("");

	const saveKey = api.useMutation(
		"put",
		"/airside/claims/{id}/verification-key",
		{
			onSuccess: async () => {
				setApiKey("");
				await invalidate();
				toast.success("Test key saved.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ?? "Failed to save the key",
				);
			},
		},
	);

	const removeKey = api.useMutation(
		"delete",
		"/airside/claims/{id}/verification-key",
		{
			onSuccess: async () => {
				await invalidate();
				toast.success("Test key removed.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to remove the key",
				);
			},
		},
	);

	return (
		<Card data-testid={`verification-key-${claim.providerId}`}>
			<CardHeader>
				<CardTitle className="font-display flex items-center gap-2">
					<KeyRound className="text-primary size-4" /> {claim.providerName} ·
					testing key
				</CardTitle>
				<CardDescription>
					Used only by preflight and verification runs — the ones you start in
					Fleet, and the ones LLMGateway runs against your listings. Stored
					encrypted and only ever shown back to you masked. Use a key separate
					from the one behind your live LLMGateway integration: this traffic is
					billed to you by your own platform and is not tracked in LLMGateway
					usage or billing.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center gap-3">
					{claim.verificationKeyMasked ? (
						<>
							<span
								className="font-mono text-sm"
								data-testid={`verification-key-masked-${claim.providerId}`}
							>
								{claim.verificationKeyMasked}
							</span>
							<span className="text-muted-foreground text-xs">
								saved <RelativeDate date={claim.verificationKeySetAt} />
							</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="ml-auto"
								data-testid={`verification-key-remove-${claim.providerId}`}
								disabled={removeKey.isPending}
								onClick={() =>
									removeKey.mutate({ params: { path: { id: claim.id } } })
								}
							>
								{removeKey.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Trash2 className="size-4" />
								)}
								Remove
							</Button>
						</>
					) : (
						<span className="text-muted-foreground text-sm">
							No test key saved — preflight asks for one on every run.
						</span>
					)}
				</div>
				<form
					className="flex max-w-md gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						saveKey.mutate({
							params: { path: { id: claim.id } },
							body: { apiKey },
						});
					}}
				>
					<Label
						htmlFor={`verification-key-input-${claim.providerId}`}
						className="sr-only"
					>
						Provider test key for {claim.providerName}
					</Label>
					<Input
						id={`verification-key-input-${claim.providerId}`}
						data-testid={`verification-key-input-${claim.providerId}`}
						type="password"
						autoComplete="off"
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						placeholder={
							claim.verificationKeyMasked
								? "Paste a new key to replace it"
								: "A key that can call your models"
						}
					/>
					<Button
						type="submit"
						className="font-semibold"
						data-testid={`verification-key-save-${claim.providerId}`}
						disabled={!apiKey.trim() || saveKey.isPending}
					>
						{saveKey.isPending
							? "Saving…"
							: claim.verificationKeyMasked
								? "Replace"
								: "Save"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function ProviderKeyCard({ claim }: { claim: Claim }) {
	const api = useApi();
	const invalidate = useInvalidateCompanies();
	const [apiKey, setApiKey] = useState("");

	const submitKey = api.useMutation(
		"put",
		"/airside/claims/{id}/provider-key",
		{
			onSuccess: async () => {
				setApiKey("");
				await invalidate();
				toast.success("Provider key submitted for review.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to submit the key",
				);
			},
		},
	);

	const withdrawKey = api.useMutation(
		"delete",
		"/airside/claims/{id}/provider-key",
		{
			onSuccess: async () => {
				await invalidate();
				toast.success("Replacement withdrawn.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to withdraw the key",
				);
			},
		},
	);

	return (
		<Card data-testid={`provider-key-${claim.providerId}`}>
			<CardHeader>
				<CardTitle className="font-display flex items-center gap-2">
					<PlaneTakeoff className="text-primary size-4" /> {claim.providerName}{" "}
					· provider key
				</CardTitle>
				<CardDescription>
					The key LLM Gateway serves your live traffic with. A replacement takes
					over once our team approves it and it passes a smoke test against one
					of your listings; until then the current key keeps serving. Stored
					encrypted and only ever shown back to you masked.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-center gap-3">
					{claim.providerKey ? (
						<>
							<span
								className="font-mono text-sm"
								data-testid={`provider-key-masked-${claim.providerId}`}
							>
								{claim.providerKey.masked}
							</span>
							<span className="text-muted-foreground text-xs">
								serving since{" "}
								<RelativeDate date={claim.providerKey.submittedAt} />
							</span>
						</>
					) : (
						<span className="text-muted-foreground text-sm">
							No provider key is serving yet.
						</span>
					)}
				</div>
				{claim.pendingProviderKey ? (
					<div
						className="bg-muted/50 flex items-center gap-3 rounded-md border px-3 py-2"
						data-testid={`provider-key-pending-${claim.providerId}`}
					>
						<span className="font-mono text-sm">
							{claim.pendingProviderKey.masked}
						</span>
						<span className="text-muted-foreground text-xs">
							awaiting review · submitted{" "}
							<RelativeDate date={claim.pendingProviderKey.submittedAt} />
						</span>
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="ml-auto"
							data-testid={`provider-key-withdraw-${claim.providerId}`}
							disabled={withdrawKey.isPending}
							onClick={() =>
								withdrawKey.mutate({ params: { path: { id: claim.id } } })
							}
						>
							{withdrawKey.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4" />
							)}
							Withdraw
						</Button>
					</div>
				) : null}
				<form
					className="flex max-w-md gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						submitKey.mutate({
							params: { path: { id: claim.id } },
							body: { apiKey },
						});
					}}
				>
					<Label
						htmlFor={`provider-key-input-${claim.providerId}`}
						className="sr-only"
					>
						New provider key for {claim.providerName}
					</Label>
					<Input
						id={`provider-key-input-${claim.providerId}`}
						data-testid={`provider-key-input-${claim.providerId}`}
						type="password"
						autoComplete="off"
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						placeholder="Paste a new key to request a swap"
					/>
					<Button
						type="submit"
						className="font-semibold"
						data-testid={`provider-key-submit-${claim.providerId}`}
						disabled={!apiKey.trim() || submitKey.isPending}
					>
						{submitKey.isPending ? "Submitting…" : "Submit for review"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

export default function SettingsPage() {
	const { company, isLoading } = useCompany();

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<Loader2 className="text-muted-foreground size-6 animate-spin" />
			</div>
		);
	}

	const activeClaims = (company?.claims ?? []).filter(
		(claim) => claim.status === "active",
	);

	return (
		<div className="space-y-6" data-testid="settings-page">
			<div>
				<p className="text-primary font-mono text-[0.65rem] tracking-[0.3em] uppercase">
					Carrier settings
				</p>
				<h1 className="font-display text-3xl font-black tracking-tight">
					Keys
				</h1>
			</div>

			{activeClaims.length === 0 ? (
				<Card>
					<CardContent className="text-muted-foreground py-8 text-center text-sm">
						No active carrier yet. Once a claim is approved you can manage its
						keys here.
					</CardContent>
				</Card>
			) : (
				activeClaims.map((claim) => (
					<div key={claim.id} className="space-y-4">
						{claim.kind === "custom" ? <ProviderKeyCard claim={claim} /> : null}
						<VerificationKeyCard claim={claim} />
					</div>
				))
			)}
		</div>
	);
}
