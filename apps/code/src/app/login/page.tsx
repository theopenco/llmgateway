"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
	Loader2,
	KeySquare,
	ArrowRight,
	Terminal,
	Code2,
	Cpu,
} from "lucide-react";
import { motion } from "motion/react";
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
			void signIn.passkey({ autoFill: true }).then((res) => {
				if (res?.data) {
					queryClient.clear();
					if (posthogKey) {
						posthog.capture("user_logged_in", { method: "passkey" });
					}
					router.push(returnUrl);
				} else if (res?.error) {
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
		}
	}, [signIn, queryClient, posthogKey, posthog, router, returnUrl]);

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
		<div className="flex min-h-screen">
			{/* Left Brand Panel */}
			<div className="relative hidden w-1/2 overflow-hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-between">
				{/* Dot grid pattern */}
				<div
					className="absolute inset-0 opacity-[0.15]"
					style={{
						backgroundImage:
							"radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
						backgroundSize: "24px 24px",
					}}
				/>
				{/* Accent glow */}
				<div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/8 blur-[100px]" />

				<div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, ease: "easeOut" }}
					>
						<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
							<div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							<span className="text-xs font-medium text-emerald-400">
								DevPass
							</span>
						</div>
						<h1 className="text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
							Welcome back,
							<br />
							developer.
						</h1>
						<p className="mt-4 max-w-md text-lg text-zinc-400">
							Your dev environment is ready. Pick up where you left off.
						</p>
					</motion.div>

					{/* Terminal mockup */}
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
						className="mt-10 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/80"
					>
						<div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
							<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
							<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
							<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
							<span className="ml-2 text-xs text-zinc-600">terminal</span>
						</div>
						<div className="p-4 font-mono text-sm">
							<p className="text-zinc-500">
								<span className="text-emerald-400">$</span> devpass status
							</p>
							<p className="mt-1 text-zinc-600">
								3 active plans, 12 tasks completed today
							</p>
							<p className="mt-1 text-emerald-400">All systems operational.</p>
						</div>
					</motion.div>

					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ duration: 0.6, delay: 0.4 }}
						className="mt-8 flex items-center gap-6"
					>
						<div className="flex items-center gap-2 text-zinc-500">
							<Terminal className="h-4 w-4" />
							<span className="text-xs">CLI Tools</span>
						</div>
						<div className="flex items-center gap-2 text-zinc-500">
							<Code2 className="h-4 w-4" />
							<span className="text-xs">AI Coding</span>
						</div>
						<div className="flex items-center gap-2 text-zinc-500">
							<Cpu className="h-4 w-4" />
							<span className="text-xs">Smart Plans</span>
						</div>
					</motion.div>
				</div>
			</div>

			{/* Right Form Panel */}
			<div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-16 xl:px-24">
				<motion.div
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, ease: "easeOut" }}
					className="mx-auto w-full max-w-[400px]"
				>
					{/* Mobile brand header */}
					<div className="mb-6 lg:hidden">
						<div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
							<div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							<span className="text-xs font-medium text-emerald-400">
								DevPass
							</span>
						</div>
					</div>

					<div className="flex flex-col space-y-2">
						<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
							Sign in
						</h1>
						<p className="text-sm text-muted-foreground">
							Sign in to access your Dev Plan
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
