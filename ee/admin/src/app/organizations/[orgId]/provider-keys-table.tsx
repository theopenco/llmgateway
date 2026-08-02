import { ProviderKeySpendDialog } from "@/components/provider-key-spend-dialog";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatUsd, hasReachedSpendLimit } from "@/lib/provider-key-spend";

import type { paths } from "@/lib/api/v1";

type ProviderKey =
	paths["/admin/organizations/{orgId}/provider-keys"]["get"]["responses"]["200"]["content"]["application/json"]["providerKeys"][number];

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function ProviderKeysTable({
	providerKeys,
}: {
	providerKeys: ProviderKey[];
}) {
	return (
		<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Provider</TableHead>
						<TableHead>Name</TableHead>
						<TableHead>Token</TableHead>
						<TableHead>Base URL</TableHead>
						<TableHead>Spend</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Created</TableHead>
						<TableHead className="text-right">Usage</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{providerKeys.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={8}
								className="h-24 text-center text-muted-foreground"
							>
								No provider keys found
							</TableCell>
						</TableRow>
					) : (
						providerKeys.map((key) => (
							<TableRow key={key.id}>
								<TableCell>
									<Badge variant="outline">{key.provider}</Badge>
								</TableCell>
								<TableCell className="text-sm">{key.name ?? "—"}</TableCell>
								<TableCell className="font-mono text-xs">{key.token}</TableCell>
								<TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
									{key.baseUrl ?? "—"}
								</TableCell>
								<TableCell className="text-sm tabular-nums">
									<div>{formatUsd(key.usage)}</div>
									{key.usageLimit !== null ? (
										<div
											className="text-[11px] text-muted-foreground"
											title="The key is automatically deactivated once its attributed spend reaches this cap."
										>
											of {formatUsd(key.usageLimit)}
										</div>
									) : null}
								</TableCell>
								<TableCell>
									{hasReachedSpendLimit(key) ? (
										<Badge
											variant="destructive"
											title={`Automatically deactivated: spend reached the ${formatUsd(
												key.usageLimit ?? "0",
											)} cap. Raise or clear the limit to re-enable.`}
										>
											limit reached
										</Badge>
									) : (
										<Badge
											variant={
												key.status === "active" ? "secondary" : "outline"
											}
										>
											{key.status ?? "active"}
										</Badge>
									)}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatDate(key.createdAt)}
								</TableCell>
								<TableCell className="text-right">
									<ProviderKeySpendDialog
										providerKeyId={key.id}
										label={key.name ?? key.provider}
									/>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
