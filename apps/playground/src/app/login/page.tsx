"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, KeySquare, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v3";

import {
	ChatBrandBadge,
	ChatBrandPanel,
} from "@/components/auth/chat-brand-panel";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
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

const formSchema = z.object({
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

function getSafeRedirectUrl(url: string | null): string {
	if (!url) {
		return "/";
	}
	if (url.startsWith("/") && !url.startsWith("//")) {
		return url;
	}
	return "/";
}

export default function LoginPage() {
	return (
		<Suspense>
			<Login />
		</Suspense>
	);
}

function Login() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const searchParams = useSearchParams();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
	const returnUrl = getSafeRedirectUrl(searchParams.get("returnUrl"));
	const didAttemptPasskeyAutofillRef = useRef(false);

	useUser({
		redirectTo: returnUrl,
		redirectWhen: "authenticated",
	});

	useEffect(() => {
		posthog.capture("page_viewed_login");
	}, [posthog]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: "",
			password: "",
		},
	});

	useEffect(() => {
		if (didAttemptPasskeyAutofillRef.current || !window.PublicKeyCredential) {
			return;
		}
		didAttemptPasskeyAutofillRef.current = true;
		void signIn.passkey({ autoFill: true }).then((res) => {
			if (res?.data) {
				queryClient.clear();
				posthog.capture("user_logged_in", { method: "passkey" });
				router.push(returnUrl);
			} else if (res?.error) {
				// Don't show error for user cancellation - this is expected when user dismisses passkey prompt
				if (res.error.message?.toLowerCase().includes("cancelled")) {
					return;
				}
				toast.error(res.error.message ?? "Failed to sign in with passkey", {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
			}
		});
	}, [posthog, queryClient, returnUrl, router, signIn]);

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		// Abort the pending conditional (autofill) passkey ceremony so it can't pop a
		// native passkey/biometric prompt after a successful email sign-in + redirect.
		WebAuthnAbortService.cancelCeremony();
		const { error } = await signIn.email(
			{
				email: values.email,
				password: values.password,
			},
			{
				onSuccess: (ctx) => {
					queryClient.clear();
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_logged_in", {
						method: "email",
						email: values.email,
					});
					toast.success("Login successful");
					router.push(returnUrl);
				},
				onError: (ctx) => {
					toast.error(ctx.error.message ?? "An unknown error occurred", {
						style: {
							backgroundColor: "var(--destructive)",
							color: "var(--destructive-foreground)",
						},
					});
				},
			},
		);

		if (error) {
			toast.error(error.message ?? "An unknown error occurred", {
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
			// Cancel the pending conditional (autofill) ceremony started on mount so
			// it doesn't collide with this modal request and abort it as "cancelled".
			WebAuthnAbortService.cancelCeremony();
			const res = await signIn.passkey();
			if (res?.error) {
				toast.error(res.error.message ?? "Failed to sign in with passkey", {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
				return;
			}
			posthog.capture("user_logged_in", { method: "passkey" });
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
		<div className="flex min-h-screen">
			<ChatBrandPanel
				headline={
					<>
						Welcome back.
						<br />
						Pick up the thread.
					</>
				}
				subline="Your chats, studios, and favorite models are right where you left them."
			/>

			<div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-16 xl:px-24">
				<motion.div
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, ease: "easeOut" }}
					className="mx-auto w-full max-w-[400px]"
				>
					<div className="mb-6 lg:hidden">
						<ChatBrandBadge />
					</div>

					<div className="flex flex-col space-y-2">
						<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
							Sign in
						</h1>
						<p className="text-sm text-muted-foreground">
							Sign in to continue your chats
						</p>
					</div>

					<div className="mt-8 space-y-4">
						<Form {...form}>
							<form
								onSubmit={form.handleSubmit(onSubmit)}
								className="space-y-4"
							>
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
										<>
											Sign in
											<ArrowRight className="ml-2 h-4 w-4" />
										</>
									)}
								</Button>
							</form>
						</Form>

						<div className="relative">
							<div className="absolute inset-0 flex items-center">
								<span className="w-full border-t" />
							</div>
							<div className="relative flex justify-center text-xs uppercase">
								<span className="bg-background px-2 text-muted-foreground">
									Or
								</span>
							</div>
						</div>

						<SocialAuthButtons
							isLoading={isLoading}
							setIsLoading={setIsLoading}
							callbackPath={returnUrl}
							errorCallbackPath="/login"
						/>

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
					</div>

					<p className="mt-6 text-center text-sm text-muted-foreground">
						<Link
							href="/signup"
							className="hover:text-foreground underline underline-offset-4 transition-colors"
						>
							Don&apos;t have an account? Sign up
						</Link>
					</p>
				</motion.div>
			</div>
		</div>
	);
}
