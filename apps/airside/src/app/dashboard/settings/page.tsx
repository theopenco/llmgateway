"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
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
					<KeyRound className="text-primary size-4" /> {claim.providerName}
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
					Test keys
				</h1>
			</div>

			{activeClaims.length === 0 ? (
				<Card>
					<CardContent className="text-muted-foreground py-8 text-center text-sm">
						No active carrier yet. Once a claim is approved you can save the key
						its preflight runs use.
					</CardContent>
				</Card>
			) : (
				activeClaims.map((claim) => (
					<VerificationKeyCard key={claim.id} claim={claim} />
				))
			)}
		</div>
	);
}
