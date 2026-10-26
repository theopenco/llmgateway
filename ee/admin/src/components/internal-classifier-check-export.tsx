"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api-error";
import { downloadBlob } from "@/lib/download-csv";
import { useFetchClient } from "@/lib/fetch-client";

type Decision = "all" | "block";

const HOUR_MS = 3_600_000;

// datetime-local works in local time; the export window is UTC, so the inputs
// hold UTC wall-clock values ("YYYY-MM-DDTHH:mm").
function toUtcInput(date: Date): string {
	return date.toISOString().slice(0, 16);
}

function fromUtcInput(value: string): string {
	return new Date(`${value}:00.000Z`).toISOString();
}

export function InternalClassifierCheckExport() {
	const fetchClient = useFetchClient();
	const [to, setTo] = useState(() => {
		const end = new Date();
		end.setUTCMinutes(0, 0, 0);
		return toUtcInput(end);
	});
	const [from, setFrom] = useState(() =>
		toUtcInput(new Date(new Date(`${to}:00.000Z`).getTime() - HOUR_MS)),
	);
	const [decision, setDecision] = useState<Decision>("all");
	const [pending, setPending] = useState(false);

	async function exportChecks() {
		setPending(true);
		try {
			const query = {
				from: fromUtcInput(from),
				to: fromUtcInput(to),
				decision,
			};
			const { data, error, response } = await fetchClient.GET(
				"/admin/content-filter/internal-checks/export",
				{ params: { query }, parseAs: "blob" },
			);
			if (error || !data) {
				toast.error(apiErrorMessage(error, "Export failed", response));
				return;
			}
			downloadBlob(
				`internal-classifier-checks-${decision}-${query.from}_to_${query.to}.csv`,
				data,
			);
		} catch (thrown) {
			// A failed page errors the response stream, rejecting the body read.
			toast.error(apiErrorMessage(thrown, "Export failed"));
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex flex-wrap items-end gap-3">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="icc-from">From (UTC)</Label>
				<Input
					id="icc-from"
					type="datetime-local"
					value={from}
					onChange={(event) => setFrom(event.target.value)}
					className="w-52"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="icc-to">To (UTC)</Label>
				<Input
					id="icc-to"
					type="datetime-local"
					value={to}
					onChange={(event) => setTo(event.target.value)}
					className="w-52"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="icc-decision">Checks</Label>
				<Select
					value={decision}
					onValueChange={(value) => setDecision(value as Decision)}
				>
					<SelectTrigger id="icc-decision" className="w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All (up to 24h)</SelectItem>
						<SelectItem value="block">Blocks only (up to 31d)</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<Button
				onClick={exportChecks}
				disabled={pending || !from || !to}
				variant="outline"
			>
				<Download className="h-4 w-4" />
				{pending ? "Exporting…" : "Export CSV"}
			</Button>
		</div>
	);
}
