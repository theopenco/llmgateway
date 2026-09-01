"use client";

import { BadgeCheck, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";

/**
 * Every carrier gets a shared channel with our crew. We have no self-serve
 * invite API, so the button pings the crew and we send the invite by hand to
 * the address the carrier already verified — no dead link to a workspace they
 * cannot join.
 */
export function CrewChannelCard({
	companyId,
	email,
}: {
	companyId: string | undefined;
	email: string;
}) {
	const api = useApi();
	const [requested, setRequested] = useState(false);

	const requestInvite = api.useMutation(
		"post",
		"/airside/companies/{id}/crew-invite",
		{
			onSuccess: () => {
				setRequested(true);
			},
			onError: (error) => {
				toast.error(
					(error as { message?: string })?.message ??
						"Failed to request the invite",
				);
			},
		},
	);

	return (
		<section
			className="border-border bg-card rounded-xl border p-6"
			data-testid="crew-channel-card"
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<MessagesSquare className="text-primary size-5 shrink-0" />
					<div>
						<h2 className="font-display font-bold">Join the crew channel</h2>
						<p className="text-muted-foreground text-sm">
							{requested ? (
								<>
									Requested — we&apos;ll send the invite to{" "}
									<span className="font-mono">{email}</span>.
								</>
							) : (
								<>
									Every carrier gets a shared channel with our crew — claim
									reviews, tariff questions, launch coordination. We&apos;ll
									invite <span className="font-mono">{email}</span>.
								</>
							)}
						</p>
					</div>
				</div>
				{requested ? (
					<span className="text-signal flex items-center gap-1.5 text-sm font-semibold">
						<BadgeCheck className="size-4" /> Invite requested
					</span>
				) : (
					<Button
						variant="outline"
						className="font-semibold"
						data-testid="request-crew-invite"
						disabled={!companyId || requestInvite.isPending}
						onClick={() =>
							companyId &&
							requestInvite.mutate({ params: { path: { id: companyId } } })
						}
					>
						{requestInvite.isPending ? "Requesting…" : "Request an invite"}
					</Button>
				)}
			</div>
			{!companyId ? (
				<p className="text-muted-foreground mt-3 text-xs">
					Register your company first.
				</p>
			) : null}
		</section>
	);
}
