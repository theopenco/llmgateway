"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { canWrite } from "@/lib/admin-role";
import { useAdminRole } from "@/lib/admin-role-context";
import { useApi } from "@/lib/fetch-client";

interface ManagedKey {
	id: string;
	comment: string | null;
	tokenMasked: string;
}

const LIST_PATH = "/admin/portrait-credentials";

function SetPairDialog({
	target,
	onOpenChange,
	onSaved,
}: {
	target: ManagedKey | null;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const $api = useApi();
	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");
	const [projectName, setProjectName] = useState("default");
	const [region, setRegion] = useState("ap-southeast-1");
	const save = $api.useMutation(
		"put",
		"/admin/portrait-credentials/{providerKeyId}",
		{
			meta: { errorMessage: "Failed to save BytePlus access key pair" },
			onSuccess: () => {
				toast.success("Access key pair saved.");
				setAccessKeyId("");
				setSecretAccessKey("");
				onSaved();
				onOpenChange(false);
			},
		},
	);

	return (
		<Dialog open={target !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (!target) {
							return;
						}
						save.mutate({
							params: { path: { providerKeyId: target.id } },
							body: {
								accessKeyId: accessKeyId.trim(),
								secretAccessKey: secretAccessKey.trim(),
								projectName: projectName.trim() || undefined,
								region: region.trim() || undefined,
							},
						});
					}}
				>
					<DialogHeader>
						<DialogTitle>BytePlus access key pair</DialogTitle>
						<DialogDescription>
							For {target?.comment ?? target?.tokenMasked}. The pair must belong
							to the same BytePlus account as this credential&apos;s API key.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2">
						<Label htmlFor="portrait-ak">Access Key ID</Label>
						<Input
							id="portrait-ak"
							value={accessKeyId}
							onChange={(e) => setAccessKeyId(e.target.value)}
							autoComplete="off"
							required
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="portrait-sk">Secret Access Key</Label>
						<Input
							id="portrait-sk"
							type="password"
							value={secretAccessKey}
							onChange={(e) => setSecretAccessKey(e.target.value)}
							autoComplete="new-password"
							required
						/>
					</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="portrait-project">Project</Label>
							<Input
								id="portrait-project"
								value={projectName}
								onChange={(e) => setProjectName(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="portrait-region">Region</Label>
							<Input
								id="portrait-region"
								value={region}
								onChange={(e) => setRegion(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={save.isPending}>
							{save.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * BytePlus IAM access key pairs on LLM Gateway's managed ByteDance
 * credentials, used to verify Seedance portraits on credits.
 */
export function PortraitCredentialsCard() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const editable = canWrite(useAdminRole());
	const [editing, setEditing] = useState<ManagedKey | null>(null);
	const { data, isLoading } = $api.useQuery("get", LIST_PATH);

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", LIST_PATH).queryKey,
		});
	};

	const remove = $api.useMutation(
		"delete",
		"/admin/portrait-credentials/{providerKeyId}",
		{
			meta: { errorMessage: "Failed to remove BytePlus access key pair" },
			onSuccess: () => {
				toast.success("Access key pair removed.");
				invalidate();
			},
		},
	);

	const activeId = data?.activeBinding?.providerKeyId ?? null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Seedance portrait access keys</CardTitle>
				<CardDescription>
					New platform portraits use the first active managed ByteDance
					credential with an access key pair; the <code>LLM_BYTEDANCE_*</code>{" "}
					env pair is only used when no managed ByteDance credential exists.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{isLoading || !data ? (
					<Loader2 className="size-4 animate-spin text-muted-foreground" />
				) : (
					<>
						<div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
							<span>
								Env pair:{" "}
								{data.env.configured ? (
									<span className="font-mono text-foreground">
										{data.env.accessKeyIdMasked} · {data.env.projectName}
									</span>
								) : (
									"not configured"
								)}
							</span>
							<span>
								Platform portraits:{" "}
								<span className="text-foreground">{data.portraitCount}</span>
							</span>
							{data.activeBinding === null && (
								<span className="text-destructive">
									No credential available for new portraits
								</span>
							)}
						</div>
						{data.managedKeys.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No managed ByteDance credentials yet.
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Credential</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Access key pair</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.managedKeys.map((key) => (
										<TableRow key={key.id}>
											<TableCell>
												<div className="flex flex-wrap items-center gap-2">
													<span>{key.comment ?? key.tokenMasked}</span>
													{activeId === key.id && (
														<Badge>Used for new portraits</Badge>
													)}
												</div>
												{key.comment && (
													<span className="font-mono text-xs text-muted-foreground">
														{key.tokenMasked}
													</span>
												)}
											</TableCell>
											<TableCell>
												<Badge variant="outline">
													{key.status ?? "unknown"}
												</Badge>
											</TableCell>
											<TableCell>
												{key.hasAssetCredentials ? (
													<div className="flex flex-wrap items-center gap-2">
														<Badge variant="secondary">Configured</Badge>
														<span className="font-mono text-xs text-muted-foreground">
															{key.accessKeyIdMasked} · {key.projectName} ·{" "}
															{key.region}
														</span>
													</div>
												) : (
													<span className="text-sm text-muted-foreground">
														Not set
													</span>
												)}
											</TableCell>
											<TableCell className="text-right">
												{editable && (
													<div className="flex justify-end gap-2">
														<Button
															size="sm"
															variant="outline"
															onClick={() => setEditing(key)}
														>
															{key.hasAssetCredentials ? "Replace" : "Set"}
														</Button>
														{key.hasAssetCredentials && (
															<Button
																size="sm"
																variant="ghost"
																aria-label="Remove access key pair"
																disabled={remove.isPending}
																onClick={() => {
																	if (
																		window.confirm(
																			"Remove this access key pair? Existing platform portraits bound to this credential will stop working.",
																		)
																	) {
																		remove.mutate({
																			params: {
																				path: { providerKeyId: key.id },
																			},
																		});
																	}
																}}
															>
																<Trash2 className="size-4" />
															</Button>
														)}
													</div>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</>
				)}
			</CardContent>
			<SetPairDialog
				target={editing}
				onOpenChange={(open) => {
					if (!open) {
						setEditing(null);
					}
				}}
				onSaved={invalidate}
			/>
		</Card>
	);
}
