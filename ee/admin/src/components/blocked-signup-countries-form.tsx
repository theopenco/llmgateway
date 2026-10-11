"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

function countryLabel(code: string): string {
	try {
		return countryNames.of(code) ?? code;
	} catch {
		return code;
	}
}

interface BlockedSignupCountriesFormProps {
	countries: string[];
}

export function BlockedSignupCountriesForm({
	countries,
}: BlockedSignupCountriesFormProps) {
	const router = useRouter();
	const readOnly = !canWrite(useAdminRole());
	const $api = useApi();
	const [value, setValue] = useState(countries.join(", "));
	const [saved, setSaved] = useState(false);
	const mutation = $api.useMutation(
		"put",
		"/admin/settings/blocked-signup-countries",
		{
			meta: { inlineError: true },
			onSuccess: (data) => {
				setValue(data.countries.join(", "));
				setSaved(true);
				router.refresh();
			},
		},
	);
	const pending = mutation.isPending;
	const error = mutation.isError
		? apiErrorMessage(mutation.error, "Failed to update the blocked countries.")
		: null;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setSaved(false);
		mutation.mutate({
			body: {
				countries: value
					.split(",")
					.map((code) => code.trim())
					.filter(Boolean),
			},
		});
	};

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Input
					aria-label="Blocked country codes"
					placeholder="e.g. KP, SY"
					value={value}
					disabled={pending || readOnly}
					autoComplete="off"
					data-1p-ignore
					data-lpignore="true"
					data-bwignore
					data-form-type="other"
					onChange={(event) => {
						setValue(event.target.value);
						setSaved(false);
					}}
				/>
				{!readOnly && (
					<Button type="submit" disabled={pending}>
						{pending ? "Saving…" : "Save"}
					</Button>
				)}
			</div>
			{countries.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{countries.map((code) => (
						<Badge key={code} variant="secondary">
							{code} — {countryLabel(code)}
						</Badge>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No countries blocked — sign-ups are accepted from everywhere.
				</p>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
			{saved && !error && (
				<p className="text-sm text-muted-foreground">Saved.</p>
			)}
		</form>
	);
}
