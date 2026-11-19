"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

export function FlaggedPayloadReportForm({
	id,
	reportReference,
}: {
	id: string;
	reportReference: string | null;
}) {
	const router = useRouter();
	const $api = useApi();
	const [reference, setReference] = useState(reportReference ?? "");
	const mutation = $api.useMutation(
		"post",
		"/admin/content-filter/flagged-payloads/{id}/report",
		{
			meta: { inlineError: true },
			onSuccess: () => router.refresh(),
		},
	);
	const error = mutation.isError
		? apiErrorMessage(mutation.error, "Failed to mark as reported")
		: null;

	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				mutation.mutate({
					params: { path: { id } },
					body: { reportReference: reference.trim() },
				});
			}}
		>
			<Label htmlFor="flagged-report-reference">
				NCMEC CyberTipline report number or reference
			</Label>
			<div className="flex flex-wrap items-center gap-2">
				<Input
					id="flagged-report-reference"
					className="w-72"
					maxLength={200}
					value={reference}
					disabled={mutation.isPending}
					onChange={(event) => setReference(event.target.value)}
				/>
				<Button
					type="submit"
					disabled={mutation.isPending || reference.trim() === ""}
				>
					{reportReference ? "Update reference" : "Mark reported"}
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				Marking a payload reported keeps it for one year from the first report
				(18 U.S.C. 2258A(h)).
			</p>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</form>
	);
}
