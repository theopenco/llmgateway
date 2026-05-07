"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuthClient } from "@/lib/auth-client";
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

const formSchema = z
	.object({
		password: z.string().min(8, {
			message: "Password must be at least 8 characters",
		}),
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords don't match",
		path: ["confirmPassword"],
	});

function ResetPasswordForm() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const authClient = useAuthClient();
	const [isLoading, setIsLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const token = searchParams.get("token");
	const errorParam = searchParams.get("error");

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { password: "", confirmPassword: "" },
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		if (!token) {
			toast({
				title: "Missing reset token. Request a new reset link.",
				variant: "destructive",
			});
			return;
		}
		setIsLoading(true);
		try {
			const { error } = await authClient.resetPassword({
				newPassword: values.password,
				token,
			});

			if (error) {
				toast({
					title: error.message ?? "Failed to reset password",
					variant: "destructive",
				});
				return;
			}

			toast({
				title: "Password updated",
				description: "Sign in with your new password.",
			});
			router.push("/login");
		} catch (err) {
			toast({
				title: err instanceof Error ? err.message : "Failed to reset password",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

	const isInvalidToken = !token || errorParam === "INVALID_TOKEN";

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
			className="mx-auto w-full max-w-[400px]"
		>
			<div className="mb-6 lg:hidden">
				<p className="text-sm font-medium uppercase tracking-widest text-primary">
					LLM Gateway
				</p>
			</div>

			{isInvalidToken ? (
				<div className="flex flex-col space-y-4">
					<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
						Reset link invalid or expired
					</h1>
					<p className="text-sm text-muted-foreground">
						This password reset link is no longer valid. Request a new one to
						continue.
					</p>
					<Button asChild className="mt-2 w-full">
						<Link href="/forgot-password">Request a new link</Link>
					</Button>
				</div>
			) : (
				<>
					<div className="flex flex-col space-y-2">
						<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
							Set a new password
						</h1>
						<p className="text-sm text-muted-foreground">
							Choose a strong password — at least 8 characters.
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
									name="password"
									render={({ field }) => (
										<FormItem>
											<FormLabel>New password</FormLabel>
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
								<FormField
									control={form.control}
									name="confirmPassword"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Confirm password</FormLabel>
											<FormControl>
												<Input
													placeholder="••••••••"
													type={showPassword ? "text" : "password"}
													autoComplete="new-password"
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
											Updating password...
										</>
									) : (
										<>
											Update password
											<ArrowRight className="ml-2 h-4 w-4" />
										</>
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
							Back to sign in
						</Link>
					</p>
				</>
			)}
		</motion.div>
	);
}

export default function ResetPassword() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-[200px] items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			}
		>
			<ResetPasswordForm />
		</Suspense>
	);
}
