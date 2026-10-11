"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { isHttpUrl } from "./carrier-profile";

export interface CarrierLinks {
	website: string;
	privacyPolicyUrl: string;
	termsUrl: string;
	statusPageUrl: string;
}

export const EMPTY_CARRIER_LINKS: CarrierLinks = {
	website: "",
	privacyPolicyUrl: "",
	termsUrl: "",
	statusPageUrl: "",
};

const FIELDS: {
	key: keyof CarrierLinks;
	label: string;
	placeholder: string;
	required: boolean;
}[] = [
	{
		key: "website",
		label: "Website",
		placeholder: "https://acme.ai",
		required: true,
	},
	{
		key: "privacyPolicyUrl",
		label: "Privacy policy URL",
		placeholder: "https://acme.ai/privacy",
		required: true,
	},
	{
		key: "termsUrl",
		label: "Terms of use URL",
		placeholder: "https://acme.ai/terms",
		required: true,
	},
	{
		key: "statusPageUrl",
		label: "Status page",
		placeholder: "https://status.acme.ai",
		required: false,
	},
];

export function carrierLinksValid(links: CarrierLinks): boolean {
	return FIELDS.every(({ key, required }) => {
		const value = links[key].trim();
		return value ? isHttpUrl(value) : !required;
	});
}

export function carrierLinksBody(links: CarrierLinks) {
	return {
		website: links.website.trim(),
		privacyPolicyUrl: links.privacyPolicyUrl.trim(),
		termsUrl: links.termsUrl.trim(),
		...(links.statusPageUrl.trim()
			? { statusPageUrl: links.statusPageUrl.trim() }
			: {}),
	};
}

export function CarrierLinksFields({
	idPrefix,
	value,
	onChange,
}: {
	idPrefix: string;
	value: CarrierLinks;
	onChange: (value: CarrierLinks) => void;
}) {
	return (
		<fieldset className="space-y-3">
			<legend className="text-sm font-semibold">Public profile</legend>
			<p className="text-muted-foreground -mt-1 text-xs">
				Shown on your public provider page. Developers check these before
				routing traffic to you.
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				{FIELDS.map((field) => {
					const id = `${idPrefix}-${field.key}`;
					const current = value[field.key];
					const invalid = !!current.trim() && !isHttpUrl(current);
					return (
						<div key={field.key} className="space-y-1.5">
							<Label htmlFor={id} className="flex items-center gap-1.5">
								{field.label}
								<span
									className={
										field.required
											? "text-primary font-mono text-[0.6rem] tracking-wider uppercase"
											: "text-muted-foreground font-mono text-[0.6rem] tracking-wider uppercase"
									}
								>
									{field.required ? "Required" : "Optional"}
								</span>
							</Label>
							<Input
								id={id}
								data-testid={id}
								type="url"
								inputMode="url"
								value={current}
								required={field.required}
								placeholder={field.placeholder}
								aria-invalid={invalid || undefined}
								aria-describedby={invalid ? `${id}-error` : undefined}
								onChange={(event) =>
									onChange({ ...value, [field.key]: event.target.value })
								}
							/>
							{invalid ? (
								<p id={`${id}-error`} className="text-destructive text-xs">
									Enter a full http(s) URL.
								</p>
							) : null}
						</div>
					);
				})}
			</div>
		</fieldset>
	);
}
