"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Github, Eye, EyeOff, Zap, Shield, Globe } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
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
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";

const createFormSchema = (isHosted: boolean) =>
	z.object({
		email: isHosted
			? z
					.string()
					.email({
						message: "Please enter a valid email address",
					})
					.refine((email) => !email.split("@")[0]?.includes("+"), {
						message: "Email addresses with '+' are not allowed",
					})
			: z.string().email({
					message: "Please enter a valid email address",
				}),
		password: z.string().min(8, {
			message: "Password must be at least 8 characters",
		}),
		newsletter: z.boolean(),
	});

export default function Signup() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const { signUp, signIn } = useAuth();
	const config = useAppConfig();

	const formSchema = createFormSchema(config.hosted);

	useUser({
		redirectTo: "/dashboard",
		redirectWhen: "authenticated",
		checkOnboarding: true,
	});

	useEffect(() => {
		posthog.capture("page_viewed_signup");
	}, [posthog]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: "",
			password: "",
			newsletter: true,
		},
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);

		const { error } = await signUp.email(
			{
				name: "",
				email: values.email,
				password: values.password,
			},
			{
				onSuccess: async (ctx) => {
					queryClient.clear();
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_signed_up", {
						email: values.email,
						newsletter: values.newsletter,
					});

					if (values.newsletter) {
						fetch(`${config.apiUrl}/public/newsletter/subscribe`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ email: values.email }),
						}).catch(() => {});
					}

					toast({
						title: "Account created",
						description:
							"Please check your email to verify your account before signing in.",
					});
					router.push("/onboarding");
				},
				onError: (ctx) => {
					toast({
						title: ctx?.error?.message ?? "Failed to sign up",
						variant: "destructive",
					});
				},
			},
		);

		if (error) {
			toast({
				title: error.message ?? "Failed to sign up",
				variant: "destructive",
			});
		}

		setIsLoading(false);
	}

	return (
		<div className="flex min-h-screen">
			{/* Left Brand Panel */}
			<div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 lg:flex lg:flex-col lg:justify-between">
				{/* Decorative grid */}
				<div
					className="absolute inset-0 opacity-[0.03]"
					style={{
						backgroundImage:
							"linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
						backgroundSize: "64px 64px",
					}}
				/>
				{/* Gradient orbs */}
				<div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-[128px]" />
				<div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary/10 blur-[128px]" />

				<div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, ease: "easeOut" }}
					>
						<p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">
							LLM Gateway
						</p>
						<h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
							One API for
							<br />
							every LLM.
						</h1>
						<p className="mt-4 max-w-md text-lg text-zinc-400">
							Route requests across providers, cut costs with smart caching, and
							ship AI features without vendor lock-in.
						</p>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
						className="mt-12 grid grid-cols-3 gap-6"
					>
						<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
							<Zap className="mb-2 h-5 w-5 text-primary" />
							<p className="text-2xl font-bold tabular-nums text-white">50M+</p>
							<p className="text-xs text-zinc-500">API calls routed</p>
						</div>
						<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
							<Shield className="mb-2 h-5 w-5 text-primary" />
							<p className="text-2xl font-bold tabular-nums text-white">
								99.9%
							</p>
							<p className="text-xs text-zinc-500">Uptime SLA</p>
						</div>
						<div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
							<Globe className="mb-2 h-5 w-5 text-primary" />
							<p className="text-2xl font-bold tabular-nums text-white">15+</p>
							<p className="text-xs text-zinc-500">LLM providers</p>
						</div>
					</motion.div>
				</div>

				<div className="relative z-10 px-12 pb-8 xl:px-16">
					<p className="text-xs text-zinc-600">
						Trusted by developers building AI-powered applications
					</p>
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
						<p className="text-sm font-medium uppercase tracking-widest text-primary">
							LLM Gateway
						</p>
					</div>

					<div className="flex flex-col space-y-2">
						<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
							Create your free account
						</h1>
						<p className="text-sm text-muted-foreground">
							No credit card required. Start building in seconds.
						</p>
					</div>

					<div className="mt-8 space-y-4">
						{/* Social auth buttons */}
						{(config.githubAuth || config.googleAuth) && (
							<>
								<div className="grid gap-3 sm:grid-cols-2">
									{config.githubAuth && (
										<Button
											onClick={async () => {
												setIsLoading(true);
												try {
													const res = await signIn.social({
														provider: "github",
														callbackURL:
															location.protocol +
															"//" +
															location.host +
															"/dashboard",
													});
													if (res?.error) {
														toast({
															title:
																res.error.message ??
																"Failed to sign up with GitHub",
															variant: "destructive",
														});
													}
												} finally {
													setIsLoading(false);
												}
											}}
											variant="outline"
											className="w-full"
											disabled={isLoading}
										>
											{isLoading ? (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											) : (
												<Github className="mr-2 h-4 w-4" />
											)}
											GitHub
										</Button>
									)}
									{config.googleAuth && (
										<Button
											onClick={async () => {
												setIsLoading(true);
												try {
													const res = await signIn.social({
														provider: "google",
														callbackURL:
															location.protocol +
															"//" +
															location.host +
															"/dashboard",
													});
													if (res?.error) {
														toast({
															title:
																res.error.message ??
																"Failed to sign up with Google",
															variant: "destructive",
														});
													}
												} finally {
													setIsLoading(false);
												}
											}}
											variant="outline"
											className="w-full"
											disabled={isLoading}
										>
											{isLoading ? (
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											) : (
												<svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
													<path
														d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
														fill="#4285F4"
													/>
													<path
														d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
														fill="#34A853"
													/>
													<path
														d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
														fill="#FBBC05"
													/>
													<path
														d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
														fill="#EA4335"
													/>
												</svg>
											)}
											Google
										</Button>
									)}
								</div>

								<div className="relative">
									<div className="absolute inset-0 flex items-center">
										<span className="w-full border-t" />
									</div>
									<div className="relative flex justify-center text-xs uppercase">
										<span className="bg-background px-2 text-muted-foreground">
											Or continue with email
										</span>
									</div>
								</div>
							</>
						)}

						{/* Email form */}
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
													autoComplete="email"
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
												<div className="relative">
													<Input
														placeholder="••••••••"
														type={showPassword ? "text" : "password"}
														autoComplete="new-password"
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
											<p className="text-xs text-muted-foreground">
												Minimum 8 characters
											</p>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="newsletter"
									render={({ field }) => (
										<FormItem>
											<div className="flex items-center gap-3">
												<FormControl>
													<Switch
														checked={field.value}
														onCheckedChange={field.onChange}
													/>
												</FormControl>
												<FormLabel className="text-sm font-normal text-muted-foreground cursor-pointer">
													Subscribe to product updates
												</FormLabel>
											</div>
										</FormItem>
									)}
								/>
								<Button type="submit" className="w-full" disabled={isLoading}>
									{isLoading ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Creating account...
										</>
									) : (
										"Start free"
									)}
								</Button>
							</form>
						</Form>
					</div>

					<p className="mt-6 text-center text-sm text-muted-foreground">
						<Link
							href="/login"
							className="hover:text-foreground underline underline-offset-4 transition-colors"
						>
							Already have an account? Sign in
						</Link>
					</p>
				</motion.div>
			</div>
		</div>
	);
}
