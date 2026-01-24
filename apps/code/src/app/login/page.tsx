"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, KeySquare } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v3";

import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";

const formSchema = z.object({
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

function getSafeRedirectUrl(url: string | null): string {
	if (!url) {
		return "/dashboard";
	}
	if (url.startsWith("/") && !url.startsWith("//")) {
		return url;
	}
	return "/dashboard";
}

function LoginForm() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const searchParams = useSearchParams();
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
	const returnUrl = getSafeRedirectUrl(searchParams.get("returnUrl"));

	useUser({
		redirectTo: returnUrl,
		redirectWhen: "authenticated",
	});

	useEffect(() => {
		if (!posthogKey) {
			return;
		}
		posthog.capture("page_viewed_login");
	}, [posthog, posthogKey]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: "",
			password: "",
		},
	});

	useEffect(() => {
		if (window.PublicKeyCredential) {
			signIn.passkey({ autoFill: true }).then((res) => {
				if (res?.data) {
					queryClient.clear();
					if (posthogKey) {
						posthog.capture("user_logged_in", { method: "passkey" });
					}
					router.push(returnUrl);
				} else if (res?.error) {
					// Don't show error for user cancellation - this is expected when user dismisses passkey prompt
					if (res.error.message?.toLowerCase().includes("cancelled")) {
						return;
					}
					toast.error(res.error.message || "Failed to sign in with passkey", {
						style: {
							backgroundColor: "var(--destructive)",
							color: "var(--destructive-foreground)",
						},
					});
				}
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		const { error } = await signIn.email(
			{
				email: values.email,
				password: values.password,
			},
			{
				onSuccess: (ctx) => {
					queryClient.clear();
					if (posthogKey) {
						posthog.identify(ctx.data.user.id, {
							email: ctx.data.user.email,
							name: ctx.data.user.name,
						});
						posthog.capture("user_logged_in", {
							method: "email",
							email: values.email,
						});
					}
					toast.success("Login successful");
					router.push(returnUrl);
				},
				onError: (ctx) => {
					toast.error(ctx.error.message || "An unknown error occurred", {
						style: {
							backgroundColor: "var(--destructive)",
							color: "var(--destructive-foreground)",
						},
					});
				},
			},
		);

		if (error) {
			toast.error(error.message || "An unknown error occurred", {
				style: {
					backgroundColor: "var(--destructive)",
					color: "var(--destructive-foreground)",
				},
			});
		}

		setIsLoading(false);
	}

	async function handlePasskeySignIn() {
		setIsLoading(true);
		try {
			const res = await signIn.passkey();
			if (res?.error) {
				toast.error(res.error.message || "Failed to sign in with passkey", {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
				return;
			}
			if (posthogKey) {
				posthog.capture("user_logged_in", { method: "passkey" });
			}
			toast.success("Login successful");
			router.push(returnUrl);
		} catch (error: unknown) {
			toast.error(
				(error as Error)?.message || "Failed to sign in with passkey",
				{
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				},
			);
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="px-4 sm:px-0 max-w-5xl mx-auto flex h-screen w-screen flex-col items-center justify-center">
			<div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
				<div className="flex flex-col space-y-2 text-center">
					<h1 className="text-2xl font-semibold tracking-tight">
						Welcome back
					</h1>
					<p className="text-sm text-muted-foreground">
						Sign in to access your Dev Plan
					</p>
				</div>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input
											placeholder="name@example.com"
											type="email"
											autoComplete="username webauthn"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password</FormLabel>
									<FormControl>
										<Input
											placeholder="••••••••"
											type="password"
											autoComplete="current-password webauthn"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Signing in...
								</>
							) : (
								"Sign in"
							)}
						</Button>
					</form>
				</Form>
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">Or</span>
					</div>
				</div>
				<Button
					onClick={handlePasskeySignIn}
					variant="outline"
					className="w-full"
					disabled={isLoading}
				>
					{isLoading ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<KeySquare className="mr-2 h-4 w-4" />
					)}
					Sign in with passkey
				</Button>
				<p className="px-8 text-center text-sm text-muted-foreground">
					<Link
						href="/signup"
						className="hover:text-primary underline underline-offset-4"
					>
						Don&apos;t have an account? Sign up
					</Link>
				</p>
			</div>
		</div>
	);
}

export default function Login() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			}
		>
			<LoginForm />
		</Suspense>
	);
}
