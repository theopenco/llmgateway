"use client";

import { FileCheck2, FileX2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";

export interface ProviderDpaRow {
	providerId: string;
	name: string;
	gdpr: boolean | null;
	headquarters: string | null;
	dpaSignedAt: string | null;
	dpaSignedBy: string | null;
	dpaNote: string | null;
}

function gdprBadge(gdpr: boolean | null) {
	if (gdpr === true) {
		return <Badge variant="secondary">GDPR: yes</Badge>;
	}
	if (gdpr === false) {
		return <Badge variant="destructive">GDPR: no</Badge>;
	}
	return <Badge variant="outline">GDPR: unstated</Badge>;
}

export function ProviderDpaTable({
	providers,
}: {
	providers: ProviderDpaRow[];
}) {
	const $api = useApi();
	const router = useRouter();
	const [editing, setEditing] = useState<ProviderDpaRow | null>(null);
	const [signedBy, setSignedBy] = useState("");
	const [note, setNote] = useState("");

	const updateMutation = $api.useMutation(
		"put",
		"/admin/provider-dpas/{providerId}",
		{
			onSuccess: () => {
				setEditing(null);
				router.refresh();
			},
		},
	);

	const openConfirm = (row: ProviderDpaRow) => {
		setSignedBy(row.dpaSignedBy ?? "");
		setNote(row.dpaNote ?? "");
		setEditing(row);
	};

	return (
		<>
			<div className="overflow-x-auto rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead>Catalogue posture</TableHead>
							<TableHead>DPA status</TableHead>
							<TableHead>Note</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{providers.map((row) => {
							const signed = row.dpaSignedAt !== null;
							return (
								<TableRow key={row.providerId}>
									<TableCell>
										<div className="font-medium">{row.name}</div>
										<div className="text-muted-foreground text-xs">
											{row.providerId}
										</div>
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap items-center gap-1.5">
											{gdprBadge(row.gdpr)}
											<Badge variant="outline">
												HQ: {row.headquarters ?? "undisclosed"}
											</Badge>
										</div>
									</TableCell>
									<TableCell>
										{signed ? (
											<div className="flex items-center gap-2">
												<FileCheck2 className="h-4 w-4 text-green-600 dark:text-green-500" />
												<div>
													<div className="text-sm font-medium">Signed</div>
													<div className="text-muted-foreground text-xs">
														{new Date(row.dpaSignedAt!).toLocaleDateString()}
														{row.dpaSignedBy ? ` · ${row.dpaSignedBy}` : ""}
													</div>
												</div>
											</div>
										) : (
											<div className="flex items-center gap-2">
												<FileX2 className="text-muted-foreground h-4 w-4" />
												<span className="text-muted-foreground text-sm">
													Not on record
												</span>
											</div>
										)}
									</TableCell>
									<TableCell className="max-w-72">
										<span className="text-muted-foreground line-clamp-2 text-xs">
											{row.dpaNote ?? "—"}
										</span>
									</TableCell>
									<TableCell className="text-right">
										{signed ? (
											<Button
												variant="outline"
												size="sm"
												disabled={updateMutation.isPending}
												onClick={() => {
													updateMutation.mutate({
														params: {
															path: { providerId: row.providerId },
														},
														body: { signed: false },
													});
												}}
											>
												Unmark
											</Button>
										) : (
											<Button
												size="sm"
												onClick={() => {
													openConfirm(row);
												}}
											>
												Mark signed
											</Button>
										)}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			<Dialog
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) {
						setEditing(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Confirm DPA for {editing?.name}</DialogTitle>
						<DialogDescription>
							Confirms that a data-processing agreement with this provider is in
							force and evidenced (filed artifact — countersigned PDF,
							acceptance record, or archived incorporated terms). When
							REQUIRE_PROVIDER_DPA_FOR_GDPR is enabled this immediately affects
							GDPR compliance routing.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="dpa-signed-by">Confirmed by</Label>
							<Input
								id="dpa-signed-by"
								value={signedBy}
								onChange={(e) => setSignedBy(e.target.value)}
								placeholder="Defaults to your admin email"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="dpa-note">Note</Label>
							<Textarea
								id="dpa-note"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder="e.g. Incorporated via service terms; dated copy filed in the compliance folder"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setEditing(null)}>
							Cancel
						</Button>
						<Button
							disabled={updateMutation.isPending}
							onClick={() => {
								if (!editing) {
									return;
								}
								updateMutation.mutate({
									params: { path: { providerId: editing.providerId } },
									body: {
										signed: true,
										signedBy: signedBy.trim() || undefined,
										note: note.trim() || undefined,
									},
								});
							}}
						>
							{updateMutation.isPending ? "Saving..." : "Mark signed"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
