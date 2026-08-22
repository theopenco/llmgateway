import { ProviderKeySpendCell } from "@/components/provider-key-spend-cell";
import { ProviderKeySpendDialog } from "@/components/provider-key-spend-dialog";
import { ProviderKeyStatusBadge } from "@/components/provider-key-status-badge";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import { KeyStatusFilter as KeyStatusFilterControl } from "./key-status-filter";

import type { paths } from "@/lib/api/v1";
import type { KeyStatusFilter } from "@/lib/key-status";

type ProviderKeysResponse =
	paths["/admin/organizations/{orgId}/provider-keys"]["get"]["responses"]["200"]["content"]["application/json"];
type ProviderKey = ProviderKeysResponse["providerKeys"][number];

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export function ProviderKeysTable({
	providerKeys,
	pkStatus,
	counts,
}: {
	providerKeys: ProviderKey[];
	pkStatus: KeyStatusFilter;
	counts: ProviderKeysResponse["counts"];
}) {
	return (
		<div className="space-y-4">
			<KeyStatusFilterControl
				param="pkStatus"
				tab="provider-keys"
				value={pkStatus}
				counts={counts}
			/>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead>Name</TableHead>
							<TableHead>Description</TableHead>
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
									colSpan={9}
									className="h-24 text-center text-muted-foreground"
								>
									{pkStatus === "all"
										? "No provider keys found"
										: `No ${pkStatus === "inactive" ? "disabled" : pkStatus} provider keys found`}
								</TableCell>
							</TableRow>
						) : (
							providerKeys.map((key) => (
								<TableRow key={key.id}>
									<TableCell>
										<Badge variant="outline">{key.provider}</Badge>
									</TableCell>
									<TableCell className="text-sm">{key.name ?? "—"}</TableCell>
									<TableCell className="max-w-[240px] truncate text-sm">
										{key.description ?? "—"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{key.token}
									</TableCell>
									<TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
										{key.baseUrl ?? "—"}
									</TableCell>
									<TableCell className="text-sm">
										<ProviderKeySpendCell keyRow={key} />
									</TableCell>
									<TableCell>
										<ProviderKeyStatusBadge keyRow={key} />
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
		</div>
	);
}
