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

function KeySection({
	title,
	description,
	testId,
	children,
}: {
	title: string;
	description: string;
	testId: string;
	children: React.ReactNode;
}) {
	return (
		<section
			className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[14rem_1fr] md:gap-8"
			data-testid={testId}
		>
			<div className="space-y-1">
				<h3 className="text-sm font-semibold">{title}</h3>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{description}
				</p>
			</div>
			<div className="max-w-xl space-y-3">{children}</div>
		</section>
	);
}

/** One row of a key's status: label, masked key, when, optional action. */
function KeyStatusRow({
	label,
	masked,
	maskedTestId,
	meta,
	action,
}: {
	label: string;
	masked: string;
	maskedTestId: string;
	meta: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
			<span className="text-muted-foreground w-16 text-xs">{label}</span>
			<span className="font-mono" data-testid={maskedTestId}>
				{masked}
			</span>
			<span className="text-muted-foreground text-xs">{meta}</span>
			{action ? <span className="ml-auto">{action}</span> : null}
		</div>
	);
}

function KeyForm({
	inputId,
	label,
	placeholder,
	submitLabel,
	pending,
	onSubmit,
}: {
	inputId: string;
	label: string;
	placeholder: string;
	submitLabel: string;
	pending: boolean;
	onSubmit: (apiKey: string, reset: () => void) => void;
}) {
	const [apiKey, setApiKey] = useState("");
	return (
		<form
			className="flex gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(apiKey, () => setApiKey(""));
			}}
		>
			<Label htmlFor={inputId} className="sr-only">
				{label}
			</Label>
			<Input
				id={inputId}
				data-testid={inputId}
				type="password"
				autoComplete="off"
				value={apiKey}
				onChange={(event) => setApiKey(event.target.value)}
				placeholder={placeholder}
			/>
			<Button
				type="submit"
				className="shrink-0 font-semibold"
				data-testid={inputId.replace("-input-", "-save-")}
				disabled={!apiKey.trim() || pending}
			>
				{submitLabel}
			</Button>
		</form>
	);
}

function TestingKeySection({ claim }: { claim: Claim }) {
	const api = useApi();
	const invalidate = useInvalidateCompanies();
	const onError = (fallback: string) => (error: unknown) => {
		toast.error((error as { message?: string })?.message ?? fallback);
	};
	const saveKey = api.useMutation(
		"put",
		"/airside/claims/{id}/verification-key",
		{
			onSuccess: async () => {
				await invalidate();
				toast.success("Testing key saved.");
			},
			onError: onError("Failed to save the key"),
		},
	);
	const removeKey = api.useMutation(
		"delete",
		"/airside/claims/{id}/verification-key",
		{
			onSuccess: async () => {
				await invalidate();
				toast.success("Testing key removed.");
			},
			onError: onError("Failed to remove the key"),
		},
	);

	return (
		<KeySection
			title="Testing key"
			description="Runs preflight and verification — yours from Fleet and ours against your listings. Billed by your own platform; not tracked in LLM Gateway usage."
			testId={`verification-key-${claim.providerId}`}
		>
			{claim.verificationKeyMasked ? (
				<KeyStatusRow
					label="Saved"
					masked={claim.verificationKeyMasked}
					maskedTestId={`verification-key-masked-${claim.providerId}`}
					meta={<RelativeDate date={claim.verificationKeySetAt} />}
					action={
						<Button
							type="button"
							size="sm"
							variant="outline"
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
					}
				/>
			) : (
				<p className="text-muted-foreground text-sm">
					No test key saved — preflight asks for one on every run.
				</p>
			)}
			<KeyForm
				inputId={`verification-key-input-${claim.providerId}`}
				label={`Testing key for ${claim.providerName}`}
				placeholder={
					claim.verificationKeyMasked
						? "Paste a new key to replace it"
						: "A key that can call your models"
				}
				submitLabel={
					saveKey.isPending
						? "Saving…"
						: claim.verificationKeyMasked
							? "Replace"
							: "Save"
				}
				pending={saveKey.isPending}
				onSubmit={(apiKey, reset) =>
					saveKey.mutate(
						{ params: { path: { id: claim.id } }, body: { apiKey } },
						{ onSuccess: reset },
					)
				}
			/>
		</KeySection>
	);
}

function ProviderKeySection({ claim }: { claim: Claim }) {
	const api = useApi();
	const invalidate = useInvalidateCompanies();
	const onError = (fallback: string) => (error: unknown) => {
		toast.error((error as { message?: string })?.message ?? fallback);
	};
	const submitKey = api.useMutation(
		"put",
		"/airside/claims/{id}/provider-key",
		{
			onSuccess: async () => {
				await invalidate();
				toast.success("Provider key submitted for review.");
			},
			onError: onError("Failed to submit the key"),
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
			onError: onError("Failed to withdraw the key"),
		},
	);

	return (
		<KeySection
			title="Provider key"
			description="Serves your live LLM Gateway traffic. Filed with your first model; a replacement is smoke-tested against one of your listings and takes over once we approve it."
			testId={`provider-key-${claim.providerId}`}
		>
			{claim.providerKey ? (
				<KeyStatusRow
					label="Serving"
					masked={claim.providerKey.masked}
					maskedTestId={`provider-key-masked-${claim.providerId}`}
					meta={
						<>
							since <RelativeDate date={claim.providerKey.submittedAt} />
						</>
					}
				/>
			) : null}
			{claim.pendingProviderKey ? (
				<KeyStatusRow
					label="In review"
					masked={claim.pendingProviderKey.masked}
					maskedTestId={`provider-key-pending-${claim.providerId}`}
					meta={
						<>
							submitted{" "}
							<RelativeDate date={claim.pendingProviderKey.submittedAt} />
						</>
					}
					action={
						// A first key is reviewed with the first model; it can be
						// replaced, not withdrawn.
						claim.providerKey ? (
							<Button
								type="button"
								size="sm"
								variant="outline"
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
						) : undefined
					}
				/>
			) : null}
			{claim.providerKey || claim.pendingProviderKey ? (
				<KeyForm
					inputId={`provider-key-input-${claim.providerId}`}
					label={`New provider key for ${claim.providerName}`}
					placeholder="Paste a new key to request a swap"
					submitLabel={
						submitKey.isPending ? "Submitting…" : "Submit for review"
					}
					pending={submitKey.isPending}
					onSubmit={(apiKey, reset) =>
						submitKey.mutate(
							{ params: { path: { id: claim.id } }, body: { apiKey } },
							{ onSuccess: reset },
						)
					}
				/>
			) : (
				<p className="text-muted-foreground text-sm">
					No provider key yet — file it with your first model in Fleet.
				</p>
			)}
		</KeySection>
	);
}

function CarrierKeysCard({ claim }: { claim: Claim }) {
	return (
		<Card data-testid={`carrier-keys-${claim.providerId}`}>
			<CardHeader>
				<CardTitle className="font-display flex items-center gap-2">
					<KeyRound className="text-primary size-4" /> {claim.providerName}
					<span className="text-muted-foreground font-mono text-xs font-normal">
						{claim.providerId}
					</span>
				</CardTitle>
				<CardDescription>
					{claim.kind === "custom"
						? "Two separate keys, so test traffic bills apart from live traffic. Both are stored encrypted and only ever shown back to you masked."
						: "We serve this carrier's traffic with our own credentials; you only supply the key preflight runs on. Stored encrypted and only ever shown back to you masked."}
				</CardDescription>
			</CardHeader>
			<CardContent className="divide-border divide-y">
				{claim.kind === "custom" ? <ProviderKeySection claim={claim} /> : null}
				<TestingKeySection claim={claim} />
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
					<CarrierKeysCard key={claim.id} claim={claim} />
				))
			)}
		</div>
	);
}
