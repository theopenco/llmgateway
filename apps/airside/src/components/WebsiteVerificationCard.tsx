"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";

/**
 * DNS proof that the company controls its website's domain. Publishing the
 * TXT record makes that domain claimable in its own right, which is what lets
 * a company whose staff mail sits on another domain still claim its carrier.
 */
export function WebsiteVerificationCard({ companyId }: { companyId: string }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(false);

	const verificationQuery = api.useQuery(
		"get",
		"/airside/companies/{id}/website-verification",
		{ params: { path: { id: companyId } } },
	);

	const check = api.useMutation(
		"post",
		"/airside/companies/{id}/website-verification",
		{
			onSuccess: async () => {
				await Promise.all([
					verificationQuery.refetch(),
					queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/airside/companies", {})
							.queryKey,
					}),
					queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/airside/claimable", {})
							.queryKey,
					}),
				]);
				toast.success("Domain verified.");
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Could not find the TXT record yet",
				);
			},
		},
	);

	const data = verificationQuery.data;
	if (!data?.domain) {
		return (
			<p className="text-muted-foreground mt-3 text-xs">
				Add your company website to verify its domain over DNS — a verified
				domain can claim carriers even when your email is on another domain.
			</p>
		);
	}

	if (data.verifiedDomain) {
		return (
			<p
				className="text-signal mt-3 flex items-center gap-1.5 text-xs"
				data-testid="website-verified"
			>
				<BadgeCheck className="size-3.5" />
				<span className="font-mono">{data.verifiedDomain}</span> verified over
				DNS — carriers on this domain are claimable.
			</p>
		);
	}

	const host = `${data.recordName}.${data.domain}`;

	return (
		<div className="border-border mt-4 rounded-lg border border-dashed p-4">
			<div className="flex items-center gap-2">
				<ShieldCheck className="text-primary size-4 shrink-0" />
				<p className="text-sm font-medium">
					Verify <span className="font-mono">{data.domain}</span> over DNS
				</p>
			</div>
			<p className="text-muted-foreground mt-1 text-xs">
				Publish this TXT record, then check. A verified domain can claim
				carriers even when your email is on a different domain.
			</p>
			<div className="bg-muted/40 mt-3 space-y-1 rounded-md p-3 font-mono text-xs break-all">
				<div>
					<span className="text-muted-foreground">name </span>
					{host}
				</div>
				<div>
					<span className="text-muted-foreground">value </span>
					{data.recordValue}
				</div>
			</div>
			<div className="mt-3 flex items-center gap-2">
				<Button
					size="sm"
					data-testid="check-website-verification"
					disabled={check.isPending}
					onClick={() => check.mutate({ params: { path: { id: companyId } } })}
				>
					{check.isPending ? "Checking…" : "Check DNS"}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={async () => {
						await navigator.clipboard.writeText(data.recordValue ?? "");
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
					}}
				>
					<Copy className="size-3.5" /> {copied ? "Copied" : "Copy value"}
				</Button>
			</div>
		</div>
	);
}
