"use client";

import { ShieldCheck } from "lucide-react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/lib/components/accordion";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";

import type { ProviderDefinition } from "@llmgateway/models";

type TriState = "default" | "true" | "false";

export interface ByokAttestationState {
	apiTraining: TriState;
	promptLogging: TriState;
	retentionPeriod: string;
}

export const EMPTY_BYOK_ATTESTATION: ByokAttestationState = {
	apiTraining: "default",
	promptLogging: "default",
	retentionPeriod: "",
};

/**
 * The attestation body to send, or undefined when every field is left on the
 * provider default (nothing to attest).
 */
export function toByokAttestationBody(state: ByokAttestationState):
	| {
			apiTraining?: boolean;
			promptLogging?: boolean;
			retentionPeriod?: string;
	  }
	| undefined {
	const body: {
		apiTraining?: boolean;
		promptLogging?: boolean;
		retentionPeriod?: string;
	} = {};
	if (state.apiTraining !== "default") {
		body.apiTraining = state.apiTraining === "true";
	}
	if (state.promptLogging !== "default") {
		body.promptLogging = state.promptLogging === "true";
	}
	const retention = state.retentionPeriod.trim();
	if (retention) {
		body.retentionPeriod = retention;
	}
	return Object.keys(body).length > 0 ? body : undefined;
}

function formatDefault(value: boolean | null | undefined): string {
	if (value === true) {
		return "Yes";
	}
	if (value === false) {
		return "No";
	}
	return "Not published";
}

const TRI_STATE_FIELDS: {
	key: "apiTraining" | "promptLogging";
	label: string;
}[] = [
	{ key: "apiTraining", label: "Trains on API prompts" },
	{ key: "promptLogging", label: "Logs prompts" },
];

export function ByokAttestationFields({
	provider,
	value,
	onChange,
}: {
	provider: ProviderDefinition | undefined;
	value: ByokAttestationState;
	onChange: (value: ByokAttestationState) => void;
}) {
	const catalogue = provider?.dataPolicy;
	const attested = toByokAttestationBody(value) !== undefined;

	return (
		<Accordion type="single" collapsible className="rounded-md border px-3">
			<AccordionItem value="attestation" className="border-b-0">
				<AccordionTrigger className="py-3 hover:no-underline">
					<span className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4 text-muted-foreground" />
						Compliance attestation
						<span className="text-xs font-normal text-muted-foreground">
							{attested ? "(attested)" : "(optional)"}
						</span>
					</span>
				</AccordionTrigger>
				<AccordionContent className="space-y-4">
					<p className="text-sm text-muted-foreground">
						If your own agreement with {provider?.name ?? "this provider"}{" "}
						differs from its published data policy (for example an approved zero
						data retention exception), record it here. Fields left on
						&quot;Provider default&quot; keep the published value. When your
						organization&apos;s compliance policy is active, routing skips this
						key if the attested terms don&apos;t satisfy it.
					</p>
					<div className="grid gap-4 sm:grid-cols-2">
						{TRI_STATE_FIELDS.map(({ key, label }) => (
							<div key={key} className="space-y-2">
								<Label htmlFor={`byok-attest-${key}`}>{label}</Label>
								<Select
									value={value[key]}
									onValueChange={(v) =>
										onChange({ ...value, [key]: v as TriState })
									}
								>
									<SelectTrigger id={`byok-attest-${key}`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="default">
											Provider default ({formatDefault(catalogue?.[key])})
										</SelectItem>
										<SelectItem value="false">No</SelectItem>
										<SelectItem value="true">Yes</SelectItem>
									</SelectContent>
								</Select>
							</div>
						))}
						<div className="space-y-2 sm:col-span-2">
							<Label htmlFor="byok-attest-retention">Retention period</Label>
							<Input
								id="byok-attest-retention"
								placeholder={`Provider default: ${catalogue?.retentionPeriod ?? "not published"}`}
								value={value.retentionPeriod}
								maxLength={64}
								onChange={(e) =>
									onChange({ ...value, retentionPeriod: e.target.value })
								}
							/>
							<p className="text-xs text-muted-foreground">
								Zero data retention requires &quot;Logs prompts&quot; to be
								&quot;No&quot; and the retention period to be exactly &quot;0
								days&quot;.
							</p>
						</div>
					</div>
					<div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
						LLM Gateway does not verify these claims. They are recorded as your
						organization&apos;s attestation, with the attesting user and
						timestamp written to the audit log.
					</div>
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
