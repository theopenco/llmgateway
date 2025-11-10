"use client";

import { Link2, Plug, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-client";

const LOCAL_STORAGE_KEY = "github_mcp_token";

export function getStoredGithubMcpToken(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(LOCAL_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setStoredGithubMcpToken(token: string | null) {
	if (typeof window === "undefined") {
		return;
	}
	try {
		if (token) {
			window.localStorage.setItem(LOCAL_STORAGE_KEY, token);
		} else {
			window.localStorage.removeItem(LOCAL_STORAGE_KEY);
		}
	} catch {
		// ignore
	}
}

export function GithubConnector() {
	const { signIn, useSession } = useAuth();
	const { data } = useSession();

	const [token, setToken] = useState<string>("");
	const [saved, setSaved] = useState<boolean>(false);
	const [showToken, setShowToken] = useState<boolean>(false);

	useEffect(() => {
		const existing = getStoredGithubMcpToken();
		if (existing) {
			setToken(existing);
		}
	}, []);

	const isSignedIn = useMemo(() => Boolean(data?.session), [data?.session]);
	const isTokenPresent = token.trim().length > 0;

	const handleSave = () => {
		setStoredGithubMcpToken(isTokenPresent ? token.trim() : null);
		setSaved(true);
		setTimeout(() => setSaved(false), 1500);
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<Plug className="size-4" />
				<div className="font-medium">GitHub Connector</div>
			</div>
			<p className="text-muted-foreground text-sm">
				Connect your GitHub account and install the LLM Gateway GitHub App. Then
				store a token for the GitHub MCP tools.
			</p>

			<div className="flex items-center gap-2">
				<Button
					variant={isSignedIn ? "outline" : "default"}
					onClick={() => {
						if (!isSignedIn) {
							// Social sign-in with GitHub via Better Auth
							void signIn.social({ provider: "github" });
						}
					}}
					disabled={isSignedIn}
				>
					<Link2 className="mr-2 size-4" />
					{isSignedIn ? "Connected" : "Sign in with GitHub"}
				</Button>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="github-mcp-token">GitHub MCP Token</Label>
				<div className="relative">
					<Input
						id="github-mcp-token"
						placeholder="ghu_xxx or fine-grained PAT"
						value={token}
						onChange={(e) => setToken(e.currentTarget.value)}
						type={showToken ? "text" : "password"}
					/>
					<button
						type="button"
						aria-label={showToken ? "Hide token" : "Show token"}
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
						onClick={() => setShowToken((v) => !v)}
					>
						{showToken ? (
							<EyeOff className="size-4" />
						) : (
							<Eye className="size-4" />
						)}
					</button>
				</div>
				<div className="flex items-center gap-2">
					<Button onClick={handleSave} disabled={!isTokenPresent}>
						Save token
					</Button>
					{saved ? (
						<span className="text-xs text-muted-foreground">Saved</span>
					) : null}
				</div>
				<p className="text-muted-foreground text-xs">
					The token will be used to call the GitHub MCP server from this
					playground. You can revoke it anytime from GitHub settings.
				</p>
			</div>

			<div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
				Requests to the GitHub MCP server will include your token as an
				Authorization header.
			</div>
		</div>
	);
}
