"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useState, useEffect } from "react";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v3";

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
	name: z.string().optional(),
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(12, { message: "Password must be at least 12 characters" }),
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

export default function SignupPage() {
	return (
		<Suspense>
			<Signup />
		</Suspense>
	);
}

function Signup() {
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const { signUp } = useAuth();
	const returnUrl = getSafeRedirectUrl(searchParams.get("returnUrl"));

	useUser({
		redirectTo: returnUrl,
		redirectWhen: "authenticated",
	});

	useEffect(() => {
		posthog.capture("page_viewed_signup");
	}, [posthog]);

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
				name: values.name?.trim() ?? "",
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
						name: values.name,
					});
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
			<ChatBrandPanel
				headline={
					<>
						Every model.
						<br />
						One chat.
					</>
				}
				subline="Chat with GPT, Claude, Gemini, and hundreds more. Compare answers side by side, then create images, video, and audio — all with one account."
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
							Create your account
						</h1>
						<p className="text-sm text-muted-foreground">
							Start chatting with the world&apos;s best models in seconds
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
										<>
											Create account
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
			</div>
		</div>
	);
}
