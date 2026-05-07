"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Terminal, Code2, Cpu } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v3";

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
	name: z.string().min(2, { message: "Name is required" }),
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

function SignupForm() {
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();
	const [isLoading, setIsLoading] = useState(false);
	const { signUp } = useAuth();
	const baseReturnUrl = getSafeRedirectUrl(searchParams.get("returnUrl"));
	const selectedPlan = searchParams.get("plan");
	const selectedCycle = searchParams.get("cycle");
	// Carry the chosen billing cycle through to the dashboard so
	// InactivePlanChooser can preselect Monthly vs Annual.
	const returnUrl =
		selectedCycle === "annual" || selectedCycle === "monthly"
			? `${baseReturnUrl}${baseReturnUrl.includes("?") ? "&" : "?"}cycle=${selectedCycle}`
			: baseReturnUrl;

	useUser({
		redirectTo: returnUrl,
		redirectWhen: "authenticated",
	});

	useEffect(() => {
		if (!posthogKey) {
			return;
		}
		posthog.capture("page_viewed_signup", { plan: selectedPlan });
	}, [posthog, posthogKey, selectedPlan]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: "",
			email: "",
			password: "",
		},
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);

		const { error } = await signUp.email(
			{
				name: values.name,
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
						posthog.capture("user_signed_up", {
							email: values.email,
							name: values.name,
							plan: selectedPlan,
						});
					}
					toast.success("Account created", {
						description:
							"Please check your email to verify your account before signing in.",
					});
					router.push(returnUrl);
				},
				onError: (ctx) => {
					toast.error(ctx.error.message ?? "Failed to sign up", {
						style: {
							backgroundColor: "var(--destructive)",
							color: "var(--destructive-foreground)",
						},
					});
				},
			},
		);

		if (error) {
			toast.error(error.message ?? "Failed to sign up", {
				style: {
					backgroundColor: "var(--destructive)",
					color: "var(--destructive-foreground)",
				},
			});
		}

		setIsLoading(false);
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
							Ship faster
							<br />
							with AI.
						</h1>
						<p className="mt-4 max-w-md text-lg text-zinc-400">
							Dev plans, coding tools, and AI-powered workflows for modern
							development teams.
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
								<span className="text-emerald-400">$</span> devpass init
								my-project
							</p>
							<p className="mt-1 text-zinc-600">
								Setting up project structure...
							</p>
							<p className="text-zinc-600">Generating dev plan...</p>
							<p className="mt-1 text-emerald-400">
								Ready! Run `devpass start` to begin.
							</p>
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
							Create an account
						</h1>
						<p className="text-sm text-muted-foreground">
							{selectedPlan
								? `Sign up to get started with the ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} plan`
								: "Get started with your dev tools"}
						</p>
					</div>

					<div className="mt-8">
						<Form {...form}>
							<form
								onSubmit={form.handleSubmit(onSubmit)}
								className="space-y-4"
							>
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Name</FormLabel>
											<FormControl>
												<Input placeholder="John Doe" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
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
											Creating account...
										</>
									) : (
										"Create account"
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

export default function Signup() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			}
		>
			<SignupForm />
		</Suspense>
	);
}
