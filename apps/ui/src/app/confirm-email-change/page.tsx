"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";

export default function ConfirmEmailChangePage() {
	const api = useApi();
	const queryClient = useQueryClient();
	const [token, setToken] = useState<string | null>(null);
	const mutation = api.useMutation("post", "/user/email/confirm", {
		onSuccess: () => queryClient.clear(),
	});

	useEffect(() => {
		const fragment = window.location.hash.slice(1);
		setToken((current) => current ?? fragment);
		window.history.replaceState(null, "", window.location.pathname);
	}, []);

	const validToken = token !== null && /^[a-f0-9]{64}$/.test(token);

	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>
						{mutation.isSuccess ? "Email updated" : "Confirm your new email"}
					</CardTitle>
					<CardDescription>
						{mutation.isSuccess
							? "Sign in with your new email address and existing password."
							: "Confirm to use this address for sign-in and password recovery. You will be signed out on all devices."}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{mutation.isSuccess ? (
						<Button asChild className="w-full">
							<Link href="/login">Sign in</Link>
						</Button>
					) : (
						<>
							{token !== null && !validToken && (
								<p role="alert" className="text-sm text-destructive">
									This link is invalid. Request a new email change from your
									account settings.
								</p>
							)}
							{mutation.isError && (
								<p role="alert" className="text-sm text-destructive">
									This change could not be confirmed. The link may have expired
									or the address may already be in use. Request a new link from
									your account settings.
								</p>
							)}
							<Button
								className="w-full"
								disabled={!validToken || mutation.isPending}
								onClick={() => {
									if (token) {
										mutation.mutate({ body: { token } });
									}
								}}
							>
								{mutation.isPending ? "Confirming…" : "Confirm email change"}
							</Button>
						</>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
