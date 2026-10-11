"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

interface BlockedSignupEmailDomainsFormProps {
	domains: string[];
}

export function BlockedSignupEmailDomainsForm({
	domains,
}: BlockedSignupEmailDomainsFormProps) {
	const router = useRouter();
	const readOnly = !canWrite(useAdminRole());
	const $api = useApi();
	const [value, setValue] = useState(domains.join("\n"));
	const [saved, setSaved] = useState(false);
	const mutation = $api.useMutation(
		"put",
		"/admin/settings/blocked-signup-email-domains",
		{
			meta: { inlineError: true },
			onSuccess: (data) => {
				setValue(data.domains.join("\n"));
				setSaved(true);
				router.refresh();
			},
		},
	);
	const pending = mutation.isPending;
	const error = mutation.isError
		? apiErrorMessage(
				mutation.error,
				"Could not save. Use valid domains without email addresses, URLs or wildcards (maximum 10,000 entries).",
			)
		: null;

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				setSaved(false);
				mutation.mutate({
					body: { domains: value.split(/[\s,]+/).filter(Boolean) },
				});
			}}
		>
			<div className="flex flex-col gap-2">
				<Label htmlFor="blocked-email-domains">Email domains</Label>
				<Textarea
					id="blocked-email-domains"
					aria-describedby="blocked-email-domains-help"
					rows={7}
					placeholder="example.com"
					value={value}
					disabled={pending || readOnly}
					spellCheck={false}
					autoCapitalize="none"
					autoComplete="off"
					// The "email" in the id makes password managers offer autofill.
					data-1p-ignore
					data-lpignore="true"
					data-bwignore
					data-form-type="other"
					onChange={(event) => {
						setValue(event.target.value);
						setSaved(false);
						mutation.reset();
					}}
				/>
				<p
					id="blocked-email-domains-help"
					className="text-sm text-muted-foreground"
				>
					One domain per line or separated by commas. Leave empty and save to
					clear all custom blocks.
				</p>
			</div>
			{!readOnly && (
				<Button className="self-start" type="submit" disabled={pending}>
					{pending ? "Saving…" : "Save domains"}
				</Button>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			{saved && !error && (
				<p role="status" className="text-sm text-muted-foreground">
					Saved.
				</p>
			)}
		</form>
	);
}
