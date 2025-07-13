"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
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
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";

const signupSchema = z.object({
	email: z.string().email("Please enter a valid email address"),
	password: z.string().min(8, "Password must be at least 8 characters"),
	name: z.string().min(1, "Name is required"),
});

type SignupForm = z.infer<typeof signupSchema>;

export default function Signup() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const [showPassword, setShowPassword] = useState(false);
	const { signUp } = useAuth();

	// Redirect to dashboard if already authenticated
	useUser({ redirectTo: "/dashboard", redirectWhen: "authenticated" });

	useEffect(() => {
		posthog.capture("page_viewed_signup");
	}, [posthog]);

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
		setError,
	} = useForm<SignupForm>({
		resolver: zodResolver(signupSchema),
	});

	const onSubmit = async (data: SignupForm) => {
		try {
			await signUp.email({
				email: data.email,
				password: data.password,
				name: data.name,
				fetchOptions: {
					onSuccess: (ctx) => {
						queryClient.clear();
						posthog.identify(ctx.data.user.id, {
							email: ctx.data.user.email,
							name: ctx.data.user.name,
						});
						posthog.capture("user_signed_up", {
							email: data.email,
							name: data.name,
						});
						toast({ title: "Account created", description: "Welcome!" });
						router.push("/onboarding");
					},
					onError: (ctx) => {
						setError("root", {
							message: ctx.error.message || "Failed to create account",
						});
					},
				},
			});
		} catch {
			setError("root", {
				message: "An error occurred. Please try again.",
			});
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
			<div className="max-w-md w-full space-y-8">
				<div>
					<h2 className="mt-6 text-center text-3xl font-extrabold ">
						Create your account
					</h2>
					<p className="mt-2 text-center text-sm">
						Or{" "}
						<Link
							href="/login"
							className="font-medium text-blue-500 hover:underline"
						>
							sign in to your existing account
						</Link>
					</p>
				</div>
				<Card>
					<CardHeader>
						<CardTitle>Get started</CardTitle>
						<CardDescription>
							Create your account to start using LLM Gateway
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="name">Full Name</Label>
								<Input
									id="name"
									type="text"
									placeholder="Enter your full name"
									{...register("name")}
								/>
								{errors.name && (
									<p className="text-sm text-red-600">{errors.name.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="email">Email</Label>
								<Input
									id="email"
									type="email"
									placeholder="Enter your email"
									{...register("email")}
								/>
								{errors.email && (
									<p className="text-sm text-red-600">{errors.email.message}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="password">Password</Label>
								<div className="relative">
									<Input
										id="password"
										type={showPassword ? "text" : "password"}
										placeholder="Enter your password"
										{...register("password")}
									/>
									<button
										type="button"
										className="absolute inset-y-0 right-0 pr-3 flex items-center"
										onClick={() => setShowPassword(!showPassword)}
									>
										{showPassword ? (
											<EyeOff className="h-4 w-4 text-gray-400" />
										) : (
											<Eye className="h-4 w-4 text-gray-400" />
										)}
									</button>
								</div>
								{errors.password && (
									<p className="text-sm text-red-600">
										{errors.password.message}
									</p>
								)}
							</div>

							{errors.root && (
								<p className="text-sm text-red-600">{errors.root.message}</p>
							)}

							<Button type="submit" className="w-full" disabled={isSubmitting}>
								{isSubmitting ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Creating account...
									</>
								) : (
									"Create account"
								)}
							</Button>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
