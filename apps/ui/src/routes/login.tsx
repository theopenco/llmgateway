import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Loader2, KeySquare } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ProductHuntBanner } from "@/components/shared/product-hunt-banner";
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

const formSchema = z.object({
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

export const Route = createFileRoute("/login")({
	component: RouteComponent,
});

function RouteComponent() {
	const QueryClient = useQueryClient();
	const navigate = useNavigate();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
	useUser({
		redirectTo: "/dashboard",
		redirectWhen: "authenticated",
		checkEmailVerification: true,
		checkOnboarding: true,
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
		if (window.PublicKeyCredential) {
			void signIn.passkey({ autoFill: true });
		}
	}, [signIn]);

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		const { error } = await signIn.email(
			{
				email: values.email,
				password: values.password,
			},
			{
				onSuccess: (ctx) => {
					QueryClient.clear();
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_logged_in", {
						method: "email",
						email: values.email,
					});
					toast({ title: "Login successful" });
					navigate({ to: "/dashboard", replace: true });
				},
				onError: (ctx) => {
					toast({
						title: ctx.error.message || "An unknown error occurred",
						variant: "destructive",
					});
				},
			},
		);

		if (error) {
			toast({
				title: error.message || "An unknown error occurred",
				variant: "destructive",
			});
		}

		setIsLoading(false);
	}

	async function handlePasskeySignIn() {
		setIsLoading(true);
		try {
			const res = await signIn.passkey();
			if (res?.error) {
				toast({
					title: res.error.message || "Failed to sign in with passkey",
					variant: "destructive",
				});
				return;
			}
			posthog.capture("user_logged_in", { method: "passkey" });
			toast({ title: "Login successful" });
			navigate({ to: "/dashboard" });
		} catch (error: any) {
			toast({
				title: error?.message || "Failed to sign in with passkey",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<>
			<ProductHuntBanner />
			<div className="px-4 sm:px-0 max-w-[64rm] mx-auto flex h-screen w-screen flex-col items-center justify-center">
				<div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
					<div className="flex flex-col space-y-2 text-center">
						<h1 className="text-2xl font-semibold tracking-tight">
							Welcome back
						</h1>
						<p className="text-sm text-muted-foreground">
							Enter your email and password to sign in to your account
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
					<p className="px-8 text-center text-sm text-muted-foreground">
						<Link
							to="/signup"
							className="hover:text-brand underline underline-offset-4"
						>
							Don&apos;t have an account? Sign up
						</Link>
					</p>
				</div>
			</div>
		</>
	);
}
