"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
	onSave: (
		countries: string[],
	) => Promise<{ countries: string[] | null; message: string | null }>;
}

export function BlockedSignupCountriesForm({
	countries,
	onSave,
}: BlockedSignupCountriesFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [value, setValue] = useState(countries.join(", "));
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await onSave(
				value
					.split(",")
					.map((code) => code.trim())
					.filter(Boolean),
			);
			if (result.countries === null) {
				setError(result.message);
				return;
			}
			setValue(result.countries.join(", "));
			setSaved(true);
			router.refresh();
		});
	};

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Input
					aria-label="Blocked country codes"
					placeholder="e.g. KP, SY"
					value={value}
					disabled={pending}
					onChange={(event) => {
						setValue(event.target.value);
						setSaved(false);
					}}
				/>
				<Button type="submit" disabled={pending}>
					{pending ? "Saving…" : "Save"}
				</Button>
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
