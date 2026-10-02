"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RelativeDate } from "@/components/RelativeDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/lib/fetch-client";

function errorMessage(error: unknown, fallback: string): string {
	return (error as { message?: string })?.message ?? fallback;
}

/**
 * Domains a company proves over DNS. A verified domain is claimable in its
 * own right, which is what lets a company whose staff mail sits on another
 * domain still claim or register its carrier.
 */
export function CompanyDomainsCard({ companyId }: { companyId: string }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [domain, setDomain] = useState("");
	const [copied, setCopied] = useState(false);
	const params = { path: { id: companyId } };

	const domainsQuery = api.useQuery("get", "/airside/companies/{id}/domains", {
		params,
	});

	// A verified domain changes what the account can claim and register on.
	const refresh = async () => {
		await Promise.all([
			domainsQuery.refetch(),
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/claimable", {}).queryKey,
			}),
		]);
	};

	const add = api.useMutation("post", "/airside/companies/{id}/domains", {
		onSuccess: async () => {
			setDomain("");
			await domainsQuery.refetch();
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not add the domain"));
		},
	});

	const verify = api.useMutation(
		"post",
		"/airside/companies/{id}/domains/{domainId}/verify",
		{
			onSuccess: async () => {
				await refresh();
				toast.success("Domain verified.");
			},
			onError: (error) => {
				toast.error(errorMessage(error, "Could not find the TXT record yet"));
			},
		},
	);

	const remove = api.useMutation(
		"delete",
		"/airside/companies/{id}/domains/{domainId}",
		{
			onSuccess: refresh,
			onError: (error) => {
				toast.error(errorMessage(error, "Could not remove the domain"));
			},
		},
	);

	const data = domainsQuery.data;
	if (!data) {
		return null;
	}

	return (
		<div className="mt-4 space-y-3" data-testid="company-domains">
			{data.domains.map((row) =>
				row.verifiedAt ? (
					<div
						key={row.id}
						className="text-signal flex items-center gap-1.5 text-xs"
						data-testid="company-domain-verified"
					>
						<BadgeCheck className="size-3.5 shrink-0" />
						<p className="flex-1">
							<span className="font-mono">{row.domain}</span> verified{" "}
							<RelativeDate date={row.verifiedAt} /> over DNS — carriers on this
							domain are claimable.
						</p>
						<Button
							size="icon"
							variant="ghost"
							className="text-muted-foreground size-6"
							aria-label={`Remove ${row.domain}`}
							disabled={remove.isPending}
							onClick={() =>
								remove.mutate({
									params: { path: { id: companyId, domainId: row.id } },
								})
							}
						>
							<X className="size-3.5" />
						</Button>
					</div>
				) : (
					<div
						key={row.id}
						className="border-border rounded-lg border border-dashed p-4"
						data-testid="company-domain-pending"
					>
						<div className="flex items-center gap-2">
							<ShieldCheck className="text-primary size-4 shrink-0" />
							<p className="text-sm font-medium">
								Verify <span className="font-mono">{row.domain}</span> over DNS
							</p>
						</div>
						<p className="text-muted-foreground mt-1 text-xs">
							Publish this TXT record, then check. A verified domain can claim
							and register carriers even when your email is on a different
							domain.
						</p>
						<div className="bg-muted/40 mt-3 space-y-1 rounded-md p-3 font-mono text-xs break-all">
							<div>
								<span className="text-muted-foreground">name </span>
								{data.recordName}.{row.domain}
							</div>
							<div>
								<span className="text-muted-foreground">value </span>
								{data.recordValue}
							</div>
						</div>
						<div className="mt-3 flex items-center gap-2">
							<Button
								size="sm"
								data-testid="check-company-domain"
								disabled={verify.isPending}
								onClick={() =>
									verify.mutate({
										params: { path: { id: companyId, domainId: row.id } },
									})
								}
							>
								{verify.isPending ? "Checking…" : "Check DNS"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={async () => {
									await navigator.clipboard.writeText(data.recordValue);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								}}
							>
								<Copy className="size-3.5" /> {copied ? "Copied" : "Copy value"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={remove.isPending}
								onClick={() =>
									remove.mutate({
										params: { path: { id: companyId, domainId: row.id } },
									})
								}
							>
								Remove
							</Button>
						</div>
					</div>
				),
			)}
			<form
				className="space-y-2"
				onSubmit={(e) => {
					e.preventDefault();
					add.mutate({ params, body: { domain } });
				}}
			>
				<Label htmlFor="company-domain" className="text-xs">
					API hosted on another domain? Add it and verify it over DNS.
				</Label>
				{data.suggestedDomain ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						data-testid="add-suggested-domain"
						disabled={add.isPending}
						onClick={() =>
							add.mutate({
								params,
								body: { domain: data.suggestedDomain ?? "" },
							})
						}
					>
						Verify <span className="font-mono">{data.suggestedDomain}</span>
					</Button>
				) : null}
				<div className="flex items-center gap-2">
					<Input
						id="company-domain"
						data-testid="company-domain-input"
						value={domain}
						required
						onChange={(e) => setDomain(e.target.value)}
						placeholder="example.cloud"
						className="h-8 font-mono text-xs"
					/>
					<Button
						type="submit"
						size="sm"
						variant="outline"
						data-testid="add-company-domain"
						disabled={add.isPending}
					>
						{add.isPending ? "Adding…" : "Add domain"}
					</Button>
				</div>
			</form>
		</div>
	);
}
