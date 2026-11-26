"use client";

import { Loader2, Terminal, ShieldCheck, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatApiKeyLimitCaps } from "@/components/api-keys/api-key-limit-fields";
import { useDevPassProject } from "@/hooks/useDevPassProject";
import { useMyMemberBudget } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { getApiErrorMessage } from "@/lib/api-error";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";

import {
	CODING_AGENTS,
	isRecognizedCodingAgent,
	mostRestrictiveApiKeyLimits,
} from "@llmgateway/shared";

interface ConnectParams {
	callback: string;
	state: string;
	source: string;
	name: string;
	// Which org the minted key should live in. The CLI passes "devpass" when
	// connecting the DevPass subscription provider so usage bills the DevPass
	// plan; pay-as-you-go connects keep using the default dashboard org.
	org: "default" | "devpass";
	// RFC 7636 S256 challenge. When present, the loopback receives a one-time
	// code the CLI redeems with its verifier, so the key never appears in a URL.
	// Older CLIs omit it and receive the key itself.
	codeChallenge: string | null;
}

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Only local loopback callbacks are allowed. The CLI starts a short-lived HTTP
 * server on localhost and passes its address here; we hand the login result
 * back to that loopback so it never leaves the user's machine.
 */
function isLoopbackCallback(callback: string): boolean {
	try {
		const url = new URL(callback);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return false;
		}
		const host = url.hostname.toLowerCase();
		return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
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
	const codeChallenge = params.get("code_challenge");
	if (!callback || !state) {
		return null;
	}
	if (
		codeChallenge !== null &&
		(params.get("code_challenge_method") !== "S256" ||
			!CODE_CHALLENGE_PATTERN.test(codeChallenge))
	) {
		return null;
	}
	return {
		callback,
		state,
		source: params.get("source") ?? "coding CLI",
		name: (params.get("name") ?? "").slice(0, 80),
		org: params.get("org") === "devpass" ? "devpass" : "default",
		codeChallenge,
	};
}

export default function ConnectCliPage() {
	const api = useApi();
	const { devpassUrl } = useAppConfig();
	const posthog = usePostHog();
	const { user, isLoading: userLoading } = useUser();

	// Read query params only after mount so SSR and the first client render agree.
	const [params, setParams] = useState<ConnectParams | null>(null);
	const [mounted, setMounted] = useState(false);
	const [done, setDone] = useState(false);
	const [selectedOrgId, setSelectedOrgId] = useState<string>();
	const [selectedProjectId, setSelectedProjectId] = useState<string>();

	useEffect(() => {
		setParams(readParams());
		setMounted(true);
	}, []);

	const wantsDevPassOrg = params?.org === "devpass";
	const devPassResult = useDevPassProject({ enabled: wantsDevPassOrg });

	// Pay-as-you-go connects let the user pick the org and project; DevPass
	// connects stay pinned to the DevPass org so usage bills the plan.
	const pickerEnabled = !!user && !!params && !wantsDevPassOrg;
	const orgsQuery = api.useQuery(
		"get",
		"/orgs",
		{},
		{ enabled: pickerEnabled },
	);
	const organizations = orgsQuery.data?.organizations ?? [];
	const organization =
		organizations.find((org) => org.id === selectedOrgId) ?? organizations[0];

	const projectsQuery = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{ params: { path: { id: organization?.id ?? "" } } },
		{ enabled: pickerEnabled && !!organization?.id },
	);
	const projects = (projectsQuery.data?.projects ?? []).filter(
		(p) => p.status !== "inactive",
	);
	const pickedProject =
		projects.find((p) => p.id === selectedProjectId) ?? projects[0];

	const project = wantsDevPassOrg ? devPassResult.data?.project : pickedProject;
	const projectLoading = wantsDevPassOrg
		? devPassResult.isLoading
		: orgsQuery.isLoading || projectsQuery.isLoading;
	const projectError = wantsDevPassOrg
		? devPassResult.isError
		: orgsQuery.isError ||
			projectsQuery.isError ||
			(!projectLoading && !pickedProject);

	// The error renders under the button, so skip the global error toast.
	const createApiKey = api.useMutation("post", "/keys/api", {
		onError: () => {},
	});
	const createApiKeyCode = api.useMutation("post", "/keys/cli-code", {
		onError: () => {},
	});

	// DevPass orgs hold exactly one API key, so a DevPass connect rolls it
	// instead of minting a second key.
	const devPassStatus = api.useQuery(
		"get",
		"/dev-plans/status",
		{},
		{ enabled: wantsDevPassOrg && !!devPassResult.data },
	);
	const refetchDevPassStatus = () => {
		void devPassStatus.refetch();
	};
	const rollDevPassKey = api.useMutation("post", "/dev-plans/rotate-api-key", {
		onError: refetchDevPassStatus,
	});
	const rollDevPassKeyCode = api.useMutation(
		"post",
		"/dev-plans/rotate-api-key/cli-code",
		{ onError: refetchDevPassStatus },
	);
	const devPassKeyId = devPassStatus.data?.apiKey?.id;
	const devPassInactive =
		wantsDevPassOrg && !!devPassStatus.data && !devPassKeyId;
	const usesCode = !!params?.codeChallenge;
	const keyMutation = wantsDevPassOrg
		? usesCode
			? rollDevPassKeyCode
			: rollDevPassKey
		: usesCode
			? createApiKeyCode
			: createApiKey;

	const budgetQuery = useMyMemberBudget(
		wantsDevPassOrg ? "" : (organization?.id ?? ""),
	);
	const keyLimits =
		budgetQuery.data && !budgetQuery.isError
			? mostRestrictiveApiKeyLimits([
					budgetQuery.data.teamBudget,
					budgetQuery.data.budget,
				])
			: null;
	const caps = keyLimits ? formatApiKeyLimitCaps(keyLimits) : null;

	const keysHref =
		!wantsDevPassOrg && organization && pickedProject
			? `/dashboard/${organization.id}/${pickedProject.id}/${
					organization.role === "developer" ? "me/api-keys" : "api-keys"
				}`
			: null;

	const displayName = params
		? (agentLabel(params.source) ?? params.source)
		: "";

	const deliver = (
		result: { key: string } | { code: string },
		keyId: string,
	) => {
		if (!params) {
			return;
		}
		posthog.capture("cli_connect_authorized", {
			source: params.source,
			keyId,
			flow: "code" in result ? "code" : "key",
		});

		const target = new URL(params.callback);
		if ("code" in result) {
			target.searchParams.set("code", result.code);
		} else {
			target.searchParams.set("key", result.key);
		}
		target.searchParams.set("state", params.state);

		setDone(true);
		// Hand the login result back to the CLI's local loopback server.
		window.location.href = target.toString();
	};

	const authorize = () => {
		if (!params || keyMutation.isPending) {
			return;
		}
		const codeChallenge = params.codeChallenge;

		if (wantsDevPassOrg) {
			if (!devPassKeyId) {
				return;
			}
			if (codeChallenge) {
				rollDevPassKeyCode.mutate(
					{ body: { apiKeyId: devPassKeyId, codeChallenge } },
					{ onSuccess: (data) => deliver({ code: data.code }, data.apiKeyId) },
				);
				return;
			}
			rollDevPassKey.mutate(
				{ body: { apiKeyId: devPassKeyId } },
				{ onSuccess: (data) => deliver({ key: data.apiKey }, data.apiKeyId) },
			);
			return;
		}

		if (!project?.id || !keyLimits) {
			return;
		}

		const ttlMs = CLI_KEY_TTL_DAYS * 24 * 60 * 60 * 1000;
		const body = {
			description: `${displayName} (CLI)${
				params.name ? ` — ${params.name}` : ""
			}`.slice(0, 100),
			projectId: project.id,
			expiresAt: new Date(Date.now() + ttlMs).toISOString(),
			...keyLimits,
		};

		if (codeChallenge) {
			createApiKeyCode.mutate(
				{ body: { ...body, codeChallenge } },
				{ onSuccess: (data) => deliver({ code: data.code }, data.apiKeyId) },
			);
			return;
		}
		createApiKey.mutate(
			{ body },
			{
				onSuccess: (data) =>
					deliver({ key: data.apiKey.token }, data.apiKey.id),
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
					{displayName} wants to connect to your LLM Gateway account.{" "}
					{wantsDevPassOrg
						? "Approving will roll your DevPass API key and send the new key to the tool running in your terminal. The previous key stops working."
						: "Approving will create an API key and send it back to the tool running in your terminal."}
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
						) : null}
					</span>
				</div>
				{!wantsDevPassOrg && organization ? (
					<div className="space-y-3">
						{organizations.length > 1 ? (
							<div className="space-y-1.5">
								<Label htmlFor="connect-org">Organization</Label>
								<Select
									value={organization.id}
									onValueChange={(id) => {
										setSelectedOrgId(id);
										setSelectedProjectId(undefined);
										createApiKey.reset();
									}}
									disabled={createApiKey.isPending}
								>
									<SelectTrigger id="connect-org" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{organizations.map((org) => (
											<SelectItem key={org.id} value={org.id}>
												{org.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}
						{pickedProject ? (
							<div className="space-y-1.5">
								<Label htmlFor="connect-project">Project</Label>
								<Select
									value={pickedProject.id}
									onValueChange={(id) => {
										setSelectedProjectId(id);
										createApiKey.reset();
									}}
									disabled={createApiKey.isPending}
								>
									<SelectTrigger id="connect-project" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{projects.map((p) => (
											<SelectItem key={p.id} value={p.id}>
												{p.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground">
									The API key is created in this project and its usage is billed
									to {organization.name}.
								</p>
							</div>
						) : null}
					</div>
				) : null}
				<p className="text-xs text-muted-foreground">
					{wantsDevPassOrg
						? "The key is delivered only to a local address on this machine and can be rolled any time from the DevPass dashboard."
						: `The key is delivered only to a local address on this machine, expires in ${CLI_KEY_TTL_DAYS} days, and can be revoked any time from the API Keys page.`}
					{caps
						? ` Its spend is capped at ${caps} to match your organization limit.`
						: null}
				</p>
			</CardContent>
			<CardFooter className="flex-col gap-2">
				<Button
					className="w-full"
					onClick={authorize}
					disabled={
						keyMutation.isPending ||
						projectLoading ||
						(wantsDevPassOrg ? !devPassKeyId : !project?.id || !keyLimits)
					}
				>
					{keyMutation.isPending ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Authorizing…
						</>
					) : (
						`Authorize ${displayName}`
					)}
				</Button>
				{projectError || devPassStatus.isError ? (
					<p className="text-xs text-destructive">
						{wantsDevPassOrg
							? "Couldn't load your DevPass organization. Refresh this page and try again."
							: organizations.length > 1
								? "No project available in this organization. Pick another one or create a project in the dashboard."
								: "No project found on your account. Finish setup in the dashboard first."}
					</p>
				) : null}
				{devPassInactive ? (
					<p className="text-xs text-destructive">
						No active DevPass subscription.{" "}
						<Link
							href={`${devpassUrl}/dashboard`}
							className="whitespace-nowrap underline"
							target="_blank"
							rel="noreferrer"
						>
							Subscribe to DevPass
						</Link>{" "}
						and try again.
					</p>
				) : null}
				{budgetQuery.isError ? (
					<p className="text-xs text-destructive">
						Couldn&apos;t load your organization limits. Refresh this page and
						try again.
					</p>
				) : null}
				{keyMutation.isError ? (
					<p className="text-xs text-destructive">
						{getApiErrorMessage(
							keyMutation.error,
							"Failed to authorize the CLI. Please try again.",
						)}
						{keysHref ? (
							<>
								{" "}
								<Link
									href={keysHref}
									className="whitespace-nowrap underline"
									target="_blank"
									rel="noreferrer"
								>
									Manage API keys
								</Link>
							</>
						) : null}
					</p>
				) : null}
			</CardFooter>
		</Card>
	);
}
