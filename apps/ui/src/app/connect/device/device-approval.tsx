"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAuthClient } from "@/lib/auth-client";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { useAppConfig } from "@/lib/config";

export function DeviceApproval({ initialCode }: { initialCode: string }) {
	const auth = useAuthClient();
	const { data: session, isPending } = auth.useSession();
	const { ssoEnabled } = useAppConfig();
	const [code, setCode] = useState(initialCode.slice(0, 12));
	const [confirmed, setConfirmed] = useState(false);
	const userCode = code.replace(/[-\s]/g, "").toUpperCase();
	const returnTo = `/connect/device?user_code=${encodeURIComponent(userCode)}`;
	const decision = useMutation({
		mutationFn: async (approve: boolean) => {
			const verified = await auth.device({ query: { user_code: userCode } });
			if (verified.error) {
				throw new Error(
					verified.error.error_description ??
						"This code is invalid or expired.",
				);
			}
			const result = approve
				? await auth.device.approve({ userCode })
				: await auth.device.deny({ userCode });
			if (result.error) {
				throw new Error(
					result.error.error_description ?? "Could not complete authorization.",
				);
			}
			return approve;
		},
	});

	if (isPending) {
		return (
			<Card>
				<CardContent className="flex justify-center py-10">
					<Loader2
						className="size-5 animate-spin"
						aria-label="Checking your session"
					/>
				</CardContent>
			</Card>
		);
	}
	if (decision.isSuccess) {
		return (
			<Card>
				<CardHeader>
					<CheckCircle2 className="mb-2 size-8 text-primary" />
					<CardTitle>
						{decision.data ? "CLI authorized" : "Request denied"}
					</CardTitle>
					<CardDescription>
						You can close this tab and return to your terminal.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<Terminal className="mb-2 size-8 text-primary" />
				<CardTitle>Authorize LLM Gateway CLI</CardTitle>
				<CardDescription>
					Connect the terminal on your device to your LLM Gateway account.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="device-code">Code from your terminal</Label>
					<Input
						id="device-code"
						value={code}
						maxLength={12}
						autoComplete="off"
						spellCheck={false}
						className="font-mono text-lg uppercase tracking-widest"
						disabled={decision.isPending}
						onChange={(event) => {
							setCode(event.target.value);
							setConfirmed(false);
							decision.reset();
						}}
					/>
				</div>
				{session?.user ? (
					<>
						<p className="text-sm">
							Signed in as <strong>{session.user.email}</strong>.
						</p>
						<p className="text-sm text-muted-foreground">
							The CLI can manage your organizations, projects, API keys, skills,
							and usage with your existing permissions. To sign out later, run{" "}
							<code>llmgateway auth logout</code> in your terminal.
						</p>
						<label className="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								checked={confirmed}
								disabled={decision.isPending}
								className="mt-1"
								onChange={(event) => setConfirmed(event.target.checked)}
							/>
							The code above matches the code in my terminal.
						</label>
					</>
				) : (
					<p className="text-sm text-muted-foreground">
						Sign in to review and approve this request.
					</p>
				)}
				<p className="text-xs text-muted-foreground">
					Only approve a request you started on your own device. Do not approve
					a code sent by someone else.
				</p>
				{decision.error && (
					<p role="alert" className="text-sm text-destructive">
						{decision.error.message}
					</p>
				)}
			</CardContent>
			<CardFooter className="flex-col gap-2">
				{session?.user ? (
					<>
						<Button
							className="w-full"
							disabled={
								!confirmed || userCode.length !== 8 || decision.isPending
							}
							onClick={() => decision.mutate(true)}
						>
							{decision.isPending && (
								<Loader2 className="mr-2 size-4 animate-spin" />
							)}
							Authorize CLI
						</Button>
						<Button
							variant="outline"
							className="w-full"
							disabled={userCode.length !== 8 || decision.isPending}
							onClick={() => decision.mutate(false)}
						>
							Deny
						</Button>
					</>
				) : (
					<>
						<Button asChild className="w-full">
							<Link href={`/login?redirect=${encodeURIComponent(returnTo)}`}>
								Sign in
							</Link>
						</Button>
						{ssoEnabled && (
							<Button asChild variant="outline" className="w-full">
								<Link href={`/sso?redirect=${encodeURIComponent(returnTo)}`}>
									Sign in with SSO
								</Link>
							</Button>
						)}
					</>
				)}
			</CardFooter>
		</Card>
	);
}
