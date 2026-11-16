"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useApi } from "@/lib/fetch-client";

import { formatNumber } from "@llmgateway/shared/number-format";

/**
 * Managed credentials failing nearly every request lately, usually a revoked or
 * out-of-credit key. Routing falls through to the next credential, so callers
 * rarely notice, but every request still pays a failed attempt first.
 */
export function FailingCredentialsWarning() {
	const api = useApi();
	const { data } = api.useQuery(
		"get",
		"/admin/provider-credentials/failing",
		{},
		{
			staleTime: 60_000,
			refetchInterval: 5 * 60_000,
			refetchOnWindowFocus: true,
		},
	);

	if (!data || data.credentials.length === 0) {
		return null;
	}

	const count = data.credentials.length;

	return (
		<Alert className="rounded-none border-x-0 border-t-0 border-red-500/40 bg-red-500/10 px-6 text-red-950 dark:text-red-100">
			<AlertTriangle aria-hidden="true" />
			<AlertTitle className="line-clamp-none">
				{count === 1
					? "A provider credential is failing"
					: `${formatNumber(count)} provider credentials are failing`}
			</AlertTitle>
			<AlertDescription className="text-current/90">
				<p>
					At least {data.thresholdPercent}% of requests failed over the last{" "}
					{data.windowHours} hours. Check whether the key was revoked or ran out
					of credit, then deactivate or replace it.
				</p>
				<ul className="mt-1 space-y-0.5">
					{data.credentials.map((credential) => (
						<li key={credential.id}>
							<Link
								href={`/provider-credentials/${encodeURIComponent(credential.id)}`}
								className="font-medium underline underline-offset-4"
							>
								{credential.provider}{" "}
								<span className="font-mono text-xs">
									{credential.maskedToken}
								</span>
							</Link>
							{credential.comment ? ` (${credential.comment})` : ""}:{" "}
							<span className="tabular-nums">
								{credential.errorRate.toFixed(1)}% (
								{formatNumber(credential.errorsCount)}/
								{formatNumber(credential.requestCount)})
							</span>
						</li>
					))}
				</ul>
			</AlertDescription>
		</Alert>
	);
}
