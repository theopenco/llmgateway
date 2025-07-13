import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
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
	name: z.string().min(2, { message: "Name is required" }),
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

export const Route = createFileRoute("/signup")({
	component: RouteComponent,
});

function RouteComponent() {
	const QueryClient = useQueryClient();
	const posthog = usePostHog();
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const { signUp } = useAuth();
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
					QueryClient.clear();
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_signed_up", {
						email: values.email,
						name: values.name,
					});
					toast({
						title: "Account created",
						description:
							"Please check your email to verify your account before signing in.",
					});
					navigate({ to: "/onboarding" });
				},
				onError: (ctx) => {
					toast({
						title: ctx.error.message || "Failed to sign up",
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
		<>
			<ProductHuntBanner />
			<div className="px-4 sm:px-0 max-w-[64rm] mx-auto flex h-screen w-screen flex-col items-center justify-center">
				<div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
					<div className="flex flex-col space-y-2 text-center">
						<h1 className="text-2xl font-semibold tracking-tight">
							Create an account
						</h1>
						<p className="text-sm text-muted-foreground">
							Enter your email below to create your account
						</p>
					</div>
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
					<p className="px-8 text-center text-sm text-muted-foreground">
						<Link
							to="/login"
							className="hover:text-brand underline underline-offset-4"
						>
							Already have an account? Sign in
						</Link>
					</p>
				</div>
			</div>
		</>
	);
}
