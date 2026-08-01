"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { useSessionStatus, useUser } from "@/hooks/useUser";
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
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";
import { useFetchClient } from "@/lib/fetch-client";

const createFormSchema = (isHosted: boolean) =>
	z.object({
		name: z.string().optional(),
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
		password: z.string().min(12, {
			message: "Password must be at least 12 characters",
		}),
		newsletter: z.boolean(),
	});

export default function Signup() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const { signUp } = useAuth();
	const config = useAppConfig();
	const fetchClient = useFetchClient();

	const formSchema = createFormSchema(config.hosted);

	const { isAuthenticated } = useSessionStatus();

	useUser({
		redirectTo: "/dashboard",
		redirectWhen: "authenticated",
		checkOnboarding: true,
		enabled: isAuthenticated,
	});

	useEffect(() => {
		posthog.capture("page_viewed_signup");
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
			name: "",
			email: "",
			password: "",
			newsletter: true,
		},
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);

		const { error } = await signUp.email(
			{
				name: values.name?.trim() ?? "",
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
						fetchClient
							.POST("/public/newsletter/subscribe", {
								body: { email: values.email },
							})
							.catch(() => {});
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
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name (optional)</FormLabel>
									<FormControl>
										<Input
											placeholder="John Doe"
											autoComplete="name"
											{...field}
										/>
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
										Minimum 12 characters
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

				{/* Divider */}
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">Or</span>
					</div>
				</div>

				{/* Social sign-up methods */}
				<SocialAuthButtons
					isLoading={isLoading}
					setIsLoading={setIsLoading}
					callbackPath="/dashboard"
					errorCallbackPath="/signup"
				/>
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
	);
}
