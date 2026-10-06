"use client";

import Link from "next/link";

export function TermsAgreement({
	id,
	checked,
	onChange,
}: {
	id: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-start gap-2.5">
			<input
				id={id}
				data-testid={id}
				type="checkbox"
				required
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="border-input accent-primary mt-0.5 size-4 shrink-0 rounded"
			/>
			<label htmlFor={id} className="text-muted-foreground text-xs leading-5">
				I agree to the Airside{" "}
				<Link
					href="/legal/terms"
					target="_blank"
					className="text-primary hover:underline"
				>
					Terms of Use
				</Link>{" "}
				and{" "}
				<Link
					href="/legal/privacy"
					target="_blank"
					className="text-primary hover:underline"
				>
					Privacy Notice
				</Link>
				.
			</label>
		</div>
	);
}
