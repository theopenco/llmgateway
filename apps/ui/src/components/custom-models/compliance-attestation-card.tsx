"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTeamMembers } from "@/hooks/useTeam";
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
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
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

import { getProviderCountries } from "@llmgateway/models";

import type { paths } from "@/lib/api/v1";

type ProviderKeysResponse =
	paths["/keys/provider"]["get"]["responses"][200]["content"]["application/json"];
type ProviderKeyItem = ProviderKeysResponse["providerKeys"][number];
type AttestationBody = NonNullable<
	NonNullable<
		paths["/keys/provider/{id}"]["patch"]["requestBody"]
	>["content"]["application/json"]["complianceAttestation"]
>;

const PROVIDER_COUNTRIES = getProviderCountries();

const TRI_STATE_FIELDS: { key: TriStateKey; label: string }[] = [
	{ key: "iso27001", label: "ISO 27001 certified" },
	{ key: "gdpr", label: "GDPR compliant" },
	{ key: "apiTraining", label: "Trains on API prompts" },
	{ key: "promptLogging", label: "Logs prompts" },
];

type TriStateKey = "iso27001" | "gdpr" | "apiTraining" | "promptLogging";

interface FormState {
	soc2: "unknown" | "1" | "2";
	iso27001: string;
	gdpr: string;
	apiTraining: string;
	promptLogging: string;
	retentionPeriod: string;
	headquarters: string;
}

function triStateFromValue(value: boolean | null | undefined): string {
	if (value === true) {
		return "true";
	}
	if (value === false) {
		return "false";
	}
	return "unknown";
}

function triStateToValue(value: string): boolean | null {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	return null;
}

function buildInitialState(
	attestation: ProviderKeyItem["complianceAttestation"],
): FormState {
	return {
		soc2:
			attestation?.soc2 === 1 ? "1" : attestation?.soc2 === 2 ? "2" : "unknown",
		iso27001: triStateFromValue(attestation?.iso27001),
		gdpr: triStateFromValue(attestation?.gdpr),
		apiTraining: triStateFromValue(attestation?.apiTraining),
		promptLogging: triStateFromValue(attestation?.promptLogging),
		retentionPeriod: attestation?.retentionPeriod ?? "",
		headquarters: attestation?.headquarters ?? "",
	};
}

export function ComplianceAttestationCard({
	providerKey,
	organizationId,
	canManage,
}: {
	providerKey: ProviderKeyItem;
	organizationId: string;
	canManage: boolean;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { data: teamData } = useTeamMembers(organizationId);

	const attestation = providerKey.complianceAttestation;
	const [form, setForm] = useState<FormState>(() =>
		buildInitialState(attestation),
	);

	const providerKeysQueryKey = api.queryOptions(
		"get",
		"/keys/provider",
	).queryKey;
	const mutation = api.useMutation("patch", "/keys/provider/{id}");

	const set = (key: keyof FormState, value: string) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	const headquartersCode = form.headquarters.trim().toUpperCase();
	const headquartersInvalid =
		headquartersCode !== "" && !/^[A-Z]{2}$/.test(headquartersCode);
	const headquartersOutsideCatalogue =
		!headquartersInvalid &&
		headquartersCode !== "" &&
		!PROVIDER_COUNTRIES.some((c) => c.code === headquartersCode);

	const attestedBy = attestation?.attestedByUserId
		? (teamData?.members.find(
				(member) => member.userId === attestation.attestedByUserId,
			)?.user ?? null)
		: null;

	const submit = (body: AttestationBody | null) => {
		mutation.mutate(
			{
				params: { path: { id: providerKey.id } },
				body: { complianceAttestation: body },
			},
			{
				onSuccess: () => {
					// The card stays mounted after a clear (it is keyed on the provider
					// key id), so drop the stale form values too — otherwise a follow-up
					// save would silently re-attest what the user just cleared.
					if (!body) {
						setForm(buildInitialState(null));
					}
					toast({
						title: body ? "Attestation saved" : "Attestation cleared",
						description: body
							? "The compliance posture of this provider has been recorded."
							: "Requests through this provider are blocked while a compliance policy is active.",
					});
					void queryClient.invalidateQueries({
						queryKey: providerKeysQueryKey,
					});
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						description:
							error instanceof Error
								? error.message
								: "Failed to update attestation",
						variant: "destructive",
					}),
			},
		);
	};

	const handleSave = () => {
		if (headquartersInvalid) {
			toast({
				title: "Invalid country code",
				description:
					"Headquarters must be an ISO 3166-1 alpha-2 country code (e.g. US).",
				variant: "destructive",
			});
			return;
		}
		submit({
			soc2: form.soc2 === "unknown" ? null : form.soc2 === "1" ? 1 : 2,
			iso27001: triStateToValue(form.iso27001),
			gdpr: triStateToValue(form.gdpr),
			apiTraining: triStateToValue(form.apiTraining),
			promptLogging: triStateToValue(form.promptLogging),
			retentionPeriod:
				form.retentionPeriod.trim() === "" ? null : form.retentionPeriod.trim(),
			headquarters: headquartersCode === "" ? null : headquartersCode,
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Compliance attestation</CardTitle>
				<CardDescription>
					Record the compliance posture of the infrastructure behind{" "}
					<span className="font-mono">
						{providerKey.name ?? providerKey.id}
					</span>
					. Your organization&apos;s provider compliance policy evaluates this
					attestation with the same fail-closed rules as catalogue providers: an
					attribute left &quot;Unknown&quot; never satisfies a requirement, and
					without an attestation all requests through this provider are blocked
					while a policy is active.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
					LLMGateway does not verify these claims. They are recorded as your
					organization&apos;s attestation about infrastructure you operate, and
					every change is written to the audit log with the attesting user and
					timestamp.
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="attest-soc2">SOC 2 report</Label>
						<Select
							value={form.soc2}
							onValueChange={(v) => set("soc2", v)}
							disabled={!canManage}
						>
							<SelectTrigger id="attest-soc2">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="unknown">Unknown / none</SelectItem>
								<SelectItem value="1">Type 1</SelectItem>
								<SelectItem value="2">Type 2</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{TRI_STATE_FIELDS.map(({ key, label }) => (
						<div key={key} className="space-y-2">
							<Label htmlFor={`attest-${key}`}>{label}</Label>
							<Select
								value={form[key]}
								onValueChange={(v) => set(key, v)}
								disabled={!canManage}
							>
								<SelectTrigger id={`attest-${key}`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="unknown">Unknown</SelectItem>
									<SelectItem value="true">Yes</SelectItem>
									<SelectItem value="false">No</SelectItem>
								</SelectContent>
							</Select>
						</div>
					))}
					<div className="space-y-2">
						<Label htmlFor="attest-retention">Retention period</Label>
						<Input
							id="attest-retention"
							placeholder='e.g. "0 days" or "30 days"'
							value={form.retentionPeriod}
							onChange={(e) => set("retentionPeriod", e.target.value)}
							disabled={!canManage}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="attest-headquarters">
							Operated from (country code)
						</Label>
						<Input
							id="attest-headquarters"
							placeholder="e.g. US"
							maxLength={2}
							list="attest-headquarters-countries"
							value={form.headquarters}
							onChange={(e) =>
								set("headquarters", e.target.value.toUpperCase())
							}
							disabled={!canManage}
						/>
						<datalist id="attest-headquarters-countries">
							{PROVIDER_COUNTRIES.map((country) => (
								<option key={country.code} value={country.code}>
									{country.name}
								</option>
							))}
						</datalist>
						{headquartersInvalid && (
							<p className="text-xs text-destructive">
								Must be an ISO 3166-1 alpha-2 country code (e.g. US).
							</p>
						)}
						{headquartersOutsideCatalogue && (
							<p className="text-xs text-amber-700 dark:text-amber-400">
								This country cannot currently be selected in your compliance
								policy&apos;s country restriction, so requests will be blocked
								while a country restriction is active.
							</p>
						)}
					</div>
				</div>

				<p className="text-xs text-muted-foreground">
					No training requires &quot;Trains on API prompts&quot; to be
					&quot;No&quot;. Zero data retention requires &quot;Logs prompts&quot;
					to be &quot;No&quot; and the retention period to be exactly &quot;0
					days&quot;. &quot;Unknown&quot; never satisfies a requirement.
				</p>

				<div className="flex items-center justify-between gap-4">
					<div className="text-xs text-muted-foreground">
						{attestation?.attestedAt ? (
							<>
								Last attested
								{attestedBy
									? ` by ${attestedBy.name ?? attestedBy.email}`
									: attestation.attestedByUserId
										? ` by ${attestation.attestedByUserId}`
										: ""}{" "}
								on {new Date(attestation.attestedAt).toLocaleString()}
							</>
						) : (
							"No attestation on file."
						)}
					</div>
					<div className="flex gap-2">
						{attestation && (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										variant="outline"
										disabled={!canManage || mutation.isPending}
										className="text-destructive"
									>
										Clear
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											Clear compliance attestation?
										</AlertDialogTitle>
										<AlertDialogDescription>
											Requests through this provider will be blocked while a
											compliance policy is active.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => submit(null)}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											Clear attestation
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
						<Button
							onClick={handleSave}
							disabled={!canManage || mutation.isPending}
						>
							{mutation.isPending ? "Saving..." : "Save attestation"}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
