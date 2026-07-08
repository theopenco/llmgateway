"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
	Loader2,
	KeySquare,
	Eye,
	EyeOff,
	ArrowRight,
	Building2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/auth-errors";
import { Button } from "@/lib/components/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";

import type { Route } from "next";

const formSchema = z.object({
	email: z.string().email({
		message: "Please enter a valid email address",
	}),
	password: z.string().min(8, {
		message: "Password must be at least 8 characters",
	}),
});

export default function Login() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const { signIn } = useAuth();
	const { ssoEnabled } = useAppConfig();

	// Support a post-login `?redirect=` target (e.g. the CLI connect flow). Only
	// same-origin relative paths are honored to avoid open-redirects.
	const [redirectTarget] = useState(() => {
		if (typeof window === "undefined") {
			return "/dashboard";
		}
		const target = new URLSearchParams(window.location.search).get("redirect");
		return target && target.startsWith("/") && !target.startsWith("//")
			? target
			: "/dashboard";
	});

	useUser({
		redirectTo: redirectTarget,
		redirectWhen: "authenticated",
		checkOnboarding: true,
	});

	useEffect(() => {
		posthog.capture("page_viewed_login");
	}, [posthog]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const error = params.get("error");
		if (error) {
			toast({
				title: getAuthErrorMessage(error),
				variant: "destructive",
			});
			params.delete("error");
			const query = params.toString();
			router.replace(window.location.pathname + (query ? `?${query}` : ""));
		}
	}, [router]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const passkeyAutofillStarted = useRef(false);
	useEffect(() => {
		// Start the conditional (autofill) passkey ceremony exactly once. Re-running
		// it restarts the WebAuthn request, which flickers the browser/password
		// manager prompt and aborts an in-progress manual passkey button click.
		if (passkeyAutofillStarted.current) {
			return;
		}
		if (typeof window === "undefined" || !window.PublicKeyCredential) {
			return;
		}
		passkeyAutofillStarted.current = true;
		void signIn.passkey({ autoFill: true }).then((res) => {
			if (res?.data) {
				queryClient.clear();
				posthog.capture("user_logged_in", { method: "passkey" });
				router.push(redirectTarget as Route);
			} else if (res?.error) {
				if (res.error.message?.toLowerCase().includes("cancelled")) {
					return;
				}
				toast({
					title: res.error.message ?? "Failed to sign in with passkey",
					variant: "destructive",
				});
			}
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
					toast({ title: "Login successful" });
					router.push(redirectTarget as Route);
				},
				onError: (ctx) => {
					toast({
						title: ctx?.error?.message ?? "An unknown error occurred",
						variant: "destructive",
					});
				},
			},
		);

		if (error) {
			toast({
				title: error.message ?? "An unknown error occurred",
				variant: "destructive",
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
				toast({
					title: res.error.message ?? "Failed to sign in with passkey",
					variant: "destructive",
				});
				return;
			}
			posthog.capture("user_logged_in", { method: "passkey" });
			toast({ title: "Login successful" });
			router.push(redirectTarget as Route);
		} catch (error: unknown) {
			toast({
				title: (error as Error)?.message || "Failed to sign in with passkey",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

	async function handleSsoSignIn() {
		const email = form.getValues("email");
		const parsed = z.string().email().safeParse(email);
		if (!parsed.success) {
			// Send the user to the dedicated SSO page, which asks only for a work
			// email — clearer than the full email+password form when SSO only needs
			// the email. Carry over whatever they've already typed.
			const query = email ? `?email=${encodeURIComponent(email)}` : "";
			router.push(`/sso${query}` as Route);
			return;
		}

		setIsLoading(true);
		// Abort the pending conditional (autofill) passkey ceremony so it can't pop a
		// native passkey/biometric prompt after the SSO redirect.
		WebAuthnAbortService.cancelCeremony();
		try {
			const res = await signIn.sso({
				email: parsed.data,
				callbackURL: location.protocol + "//" + location.host + "/dashboard",
				errorCallbackURL: location.protocol + "//" + location.host + "/login",
			});
			if (res?.error) {
				toast({
					title:
						res.error.message ??
						"No SSO connection found for this email domain",
					variant: "destructive",
				});
			}
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
			className="mx-auto w-full max-w-[400px]"
		>
			{/* Mobile brand header */}
			<div className="mb-6 lg:hidden">
				<p className="text-sm font-medium uppercase tracking-widest text-primary">
					LLM Gateway
				</p>
			</div>

			<div className="flex flex-col space-y-2">
				<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
					Sign in
				</h1>
				<p className="text-sm text-muted-foreground">
					Enter your credentials to access your dashboard
				</p>
			</div>

			<div className="mt-8 space-y-4">
				{/* Email/Password form */}
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
									<div className="flex items-center justify-between">
										<FormLabel>Password</FormLabel>
										<Link
											href="/forgot-password"
											className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
										>
											Forgot password?
										</Link>
									</div>
									<FormControl>
										<div className="relative">
											<Input
												placeholder="••••••••"
												type={showPassword ? "text" : "password"}
												autoComplete="current-password webauthn"
												className="pr-10"
												{...field}
											/>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
												onClick={() => setShowPassword(!showPassword)}
												tabIndex={-1}
											>
												{showPassword ? (
													<EyeOff className="h-4 w-4 text-muted-foreground" />
												) : (
													<Eye className="h-4 w-4 text-muted-foreground" />
												)}
												<span className="sr-only">
													{showPassword ? "Hide password" : "Show password"}
												</span>
											</Button>
										</div>
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

				{/* Divider */}
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">Or</span>
					</div>
				</div>

				{/* Alternative sign-in methods */}
				<SocialAuthButtons
					isLoading={isLoading}
					setIsLoading={setIsLoading}
					callbackPath={redirectTarget}
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

				{ssoEnabled && (
					<Button
						onClick={handleSsoSignIn}
						variant="outline"
						className="w-full"
						disabled={isLoading}
					>
						{isLoading ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Building2 className="mr-2 h-4 w-4" />
						)}
						Sign in with SSO
					</Button>
				)}
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
	);
}
