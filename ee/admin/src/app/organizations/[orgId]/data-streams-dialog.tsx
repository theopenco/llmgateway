"use client";

import { Loader2, RadioTower } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

interface DataStreamsDialogProps {
	orgId: string;
	orgName: string;
	dataStreamsEnabled: boolean;
	requestLogExportEnabled: boolean;
}

export function DataStreamsDialog({
	orgId,
	orgName,
	dataStreamsEnabled,
	requestLogExportEnabled,
}: DataStreamsDialogProps) {
	const router = useRouter();
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const [streams, setStreams] = useState(dataStreamsEnabled);
	const [requestLogs, setRequestLogs] = useState(requestLogExportEnabled);

	const saveMutation = $api.useMutation(
		"patch",
		"/admin/organizations/{orgId}/data-streams",
		{
			meta: { inlineError: true },
			onSuccess: () => {
				setOpen(false);
				router.refresh();
			},
		},
	);
	const loading = saveMutation.isPending;
	const error = saveMutation.isError
		? apiErrorMessage(saveMutation.error, "Failed to update data stream access")
		: null;

	const handleOpenChange = (next: boolean) => {
		if (next) {
			saveMutation.reset();
			setStreams(dataStreamsEnabled);
			setRequestLogs(requestLogExportEnabled);
		}
		setOpen(next);
	};

	const handleSubmit = () => {
		saveMutation.mutate({
			params: { path: { orgId } },
			body: {
				dataStreamsEnabled: streams,
				requestLogExportEnabled: streams && requestLogs,
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<RadioTower className="mr-1.5 h-4 w-4" />
					Data Streams
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Data Streams</DialogTitle>
					<DialogDescription>
						Lets {orgName} forward audit logs and export request log metadata to
						its own HTTPS endpoint. Enable only after agreeing it with the
						customer.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-1">
							<Label htmlFor="dataStreamsEnabled">Enable data streams</Label>
							<p className="text-xs text-muted-foreground">
								SIEM forwarding of audit logs. Owners and admins can then manage
								streams in the dashboard.
							</p>
						</div>
						<Checkbox
							id="dataStreamsEnabled"
							checked={streams}
							onCheckedChange={(checked) => {
								const next = checked === true;
								setStreams(next);
								if (!next) {
									setRequestLogs(false);
								}
							}}
						/>
					</div>
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-1">
							<Label htmlFor="requestLogExportEnabled">
								Enable request log export
							</Label>
							<p className="text-xs text-muted-foreground">
								Off by default: each pass reads this organization&apos;s request
								logs, so size the organization before turning it on. Metadata
								only, never prompts or completions.
							</p>
						</div>
						<Checkbox
							id="requestLogExportEnabled"
							checked={streams && requestLogs}
							disabled={!streams}
							onCheckedChange={(checked) => setRequestLogs(checked === true)}
						/>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={loading}>
						{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
