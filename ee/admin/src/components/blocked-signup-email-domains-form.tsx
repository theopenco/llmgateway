"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface BlockedSignupEmailDomainsFormProps {
	domains: string[];
	onSave: (
		domains: string[],
	) => Promise<{ domains: string[] | null; message: string | null }>;
}

export function BlockedSignupEmailDomainsForm({
	domains,
	onSave,
}: BlockedSignupEmailDomainsFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [value, setValue] = useState(domains.join("\n"));
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				setError(null);
				setSaved(false);
				startTransition(async () => {
					try {
						const result = await onSave(value.split(/[\s,]+/).filter(Boolean));
						if (result.domains === null) {
							setError(result.message);
							return;
						}
						setValue(result.domains.join("\n"));
						setSaved(true);
						router.refresh();
					} catch {
						setError("Could not save the blocked domains. Please try again.");
					}
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
					disabled={pending}
					spellCheck={false}
					autoCapitalize="none"
					onChange={(event) => {
						setValue(event.target.value);
						setSaved(false);
						setError(null);
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
			<Button className="self-start" type="submit" disabled={pending}>
				{pending ? "Saving…" : "Save domains"}
			</Button>
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
