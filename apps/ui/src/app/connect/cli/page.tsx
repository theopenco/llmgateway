"use client";

import { Loader2, Terminal, ShieldCheck, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { useDefaultProject } from "@/hooks/useDefaultProject";
import { useDevPassProject } from "@/hooks/useDevPassProject";
import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { CODING_AGENTS, isRecognizedCodingAgent } from "@llmgateway/shared";

interface ConnectParams {
	callback: string;
	state: string;
	source: string;
	name: string;
	// Which org the minted key should live in. The CLI passes "devpass" when
	// connecting the DevPass subscription provider so usage bills the DevPass
	// plan; pay-as-you-go connects keep using the default dashboard org.
	org: "default" | "devpass";
}

/**
 * Only local loopback callbacks are allowed. The CLI starts a short-lived HTTP
 * server on localhost and passes its address here; we hand the freshly minted
 * API key back to that loopback so it never leaves the user's machine.
 */
function isLoopbackCallback(callback: string): boolean {
	try {
		const url = new URL(callback);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return false;
		}
		const host = url.hostname.toLowerCase();
		return host === "localhost" || host === "127.0.0.1" || host === "::1";
	} catch {
		return false;
	}
}

// Freshly minted CLI keys expire so a leaked key can't be used indefinitely.
// This is time-based (not a spend cap) so it never interferes with how DevPass
// subscription usage is metered.
const CLI_KEY_TTL_DAYS = 90;

// Label for a recognized coding-agent source, or undefined if not recognized.
function agentLabel(source: string): string | undefined {
	return CODING_AGENTS.find((a) => a.xSourceValues.includes(source))?.label;
}

function readParams(): ConnectParams | null {
	if (typeof window === "undefined") {
		return null;
	}
	const params = new URLSearchParams(window.location.search);
	const callback = params.get("callback") ?? "";
	const state = params.get("state") ?? "";
	if (!callback || !state) {
		return null;
	}
	return {
		callback,
		state,
		source: params.get("source") ?? "coding CLI",
		name: (params.get("name") ?? "DevPass Code CLI").slice(0, 80),
		org: params.get("org") === "devpass" ? "devpass" : "default",
	};
}

export default function ConnectCliPage() {
	const api = useApi();
	const posthog = usePostHog();
	const { user, isLoading: userLoading } = useUser();

	// Read query params only after mount so SSR and the first client render agree.
	const [params, setParams] = useState<ConnectParams | null>(null);
	const [mounted, setMounted] = useState(false);
	const [done, setDone] = useState(false);

	useEffect(() => {
		setParams(readParams());
		setMounted(true);
	}, []);

	const wantsDevPassOrg = params?.org === "devpass";
	const devPassResult = useDevPassProject({ enabled: wantsDevPassOrg });
	const defaultResult = useDefaultProject();

	const project = wantsDevPassOrg
		? devPassResult.data?.project
		: defaultResult.data;
	const projectLoading = wantsDevPassOrg
		? devPassResult.isLoading
		: defaultResult.isLoading;
	const projectError = wantsDevPassOrg
		? devPassResult.isError
		: defaultResult.isError;

	const createApiKey = api.useMutation("post", "/keys/api");

	const displayName = params
		? (agentLabel(params.source) ?? params.source)
		: "";

	const authorize = () => {
		if (!params || !project?.id || createApiKey.isPending) {
			return;
		}

		const ttlMs = CLI_KEY_TTL_DAYS * 24 * 60 * 60 * 1000;
		const expiresAt = new Date(Date.now() + ttlMs).toISOString();

		createApiKey.mutate(
			{
				body: {
					description: `${displayName} (CLI) — ${params.name}`.slice(0, 100),
					projectId: project.id,
					usageLimit: null,
					expiresAt,
				},
			},
			{
				onSuccess: (data) => {
					posthog.capture("cli_connect_authorized", {
						source: params.source,
						keyId: data.apiKey.id,
					});

					const target = new URL(params.callback);
					target.searchParams.set("key", data.apiKey.token);
					target.searchParams.set("state", params.state);

					setDone(true);
					// Hand the credential back to the CLI's local loopback server.
					window.location.href = target.toString();
				},
				onError: () => {
					toast({
						title: "Failed to authorize the CLI. Please try again.",
						variant: "destructive",
					});
				},
			},
		);
	};

	if (!mounted || userLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-10">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	if (
		!params ||
		!isLoopbackCallback(params.callback) ||
		!isRecognizedCodingAgent(params.source)
	) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Invalid connection request</CardTitle>
					<CardDescription>
						This link is missing required information, points at a non-local
						address, or comes from an unrecognized tool. Start the login again
						from your terminal.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (done) {
		return (
			<Card>
				<CardHeader>
					<div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
						<CheckCircle2 className="h-5 w-5 text-primary" />
					</div>
					<CardTitle>You&apos;re connected</CardTitle>
					<CardDescription>
						{displayName} has been authorized. You can close this tab and return
						to your terminal.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (!user) {
		const returnTo = `/connect/cli${typeof window !== "undefined" ? window.location.search : ""}`;
		return (
			<Card>
				<CardHeader>
					<div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
						<Terminal className="h-5 w-5 text-primary" />
					</div>
					<CardTitle>Sign in to authorize {displayName}</CardTitle>
					<CardDescription>
						Sign in to your LLM Gateway account to connect {displayName} to your
						terminal.
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button asChild className="w-full">
						<Link href={`/login?redirect=${encodeURIComponent(returnTo)}`}>
							Sign in to continue
						</Link>
					</Button>
				</CardFooter>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
					<Terminal className="h-5 w-5 text-primary" />
				</div>
				<CardTitle>Authorize {displayName}</CardTitle>
				<CardDescription>
					{displayName} wants to connect to your LLM Gateway account. Approving
					will create an API key and send it back to the tool running in your
					terminal.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<div className="flex items-start gap-2 text-muted-foreground">
					<ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
					<span>
						Signed in as{" "}
						<span className="font-medium text-foreground">{user.email}</span>
						{wantsDevPassOrg && devPassResult.data?.organization.name ? (
							<>
								{" "}
								· organization{" "}
								<span className="font-medium text-foreground">
									{devPassResult.data.organization.name}
								</span>
							</>
						) : !wantsDevPassOrg && project?.name ? (
							<>
								{" "}
								· project{" "}
								<span className="font-medium text-foreground">
									{project.name}
								</span>
							</>
						) : null}
					</span>
				</div>
				<p className="text-xs text-muted-foreground">
					The key is delivered only to a local address on this machine, expires
					in {CLI_KEY_TTL_DAYS} days, and can be revoked any time from the API
					Keys page.
				</p>
			</CardContent>
			<CardFooter className="flex-col gap-2">
				<Button
					className="w-full"
					onClick={authorize}
					disabled={createApiKey.isPending || projectLoading || !project?.id}
				>
					{createApiKey.isPending ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Authorizing…
						</>
					) : (
						`Authorize ${displayName}`
					)}
				</Button>
				{projectError ? (
					<p className="text-xs text-destructive">
						{wantsDevPassOrg
							? "Couldn't load your DevPass organization. Refresh this page and try again."
							: "No project found on your account. Finish setup in the dashboard first."}
					</p>
				) : null}
			</CardFooter>
		</Card>
	);
}
