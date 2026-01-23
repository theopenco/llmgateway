"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Github, Eye, EyeOff } from "lucide-react";
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

	// Redirect to dashboard if already authenticated
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
				onSuccess: (ctx) => {
					queryClient.clear();
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_signed_up", {
						email: values.email,
					});
					toast({
						title: "Account created",
						description:
							"Please check your email to verify your account before signing in.",
					});
					router.push("/onboarding");
				},
				onError: (ctx) => {
					toast({
						title: ctx?.error?.message || "Failed to sign up",
						variant: "destructive",
					});
				},
			},
		);

		if (error) {
			toast({
				title: error.message || "Failed to sign up",
				variant: "destructive",
			});
		}

		setIsLoading(false);
	}

	return (
		<div className="px-4 sm:px-0 max-w-[64rem] mx-auto flex min-h-screen w-screen flex-col items-center justify-center py-10">
			<div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
				<div className="flex flex-col space-y-2 text-center">
					<h1 className="text-2xl font-semibold tracking-tight">
						Create your free account
					</h1>
					<p className="text-sm text-muted-foreground">
						No credit card required
					</p>
				</div>
				<Button
					onClick={async () => {
						setIsLoading(true);
						try {
							const res = await signIn.social({
								provider: "github",
								callbackURL:
									location.protocol + "//" + location.host + "/dashboard",
							});
							if (res?.error) {
								toast({
									title: res.error.message || "Failed to sign up with GitHub",
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
					Continue with GitHub
				</Button>
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
				<p className="px-8 text-center text-sm text-muted-foreground">
					<Link
						href="/login"
						className="hover:text-brand underline underline-offset-4"
					>
						Already have an account? Sign in
					</Link>
				</p>
				<div className="pt-4 border-t">
					<p className="text-xs text-center text-muted-foreground">
						Trusted by developers building AI-powered applications
					</p>
				</div>
			</div>
		</div>
	);
}
