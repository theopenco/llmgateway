"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Code2, Cpu, Loader2, Terminal } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
import { useAuthClient } from "@/lib/auth-client";

const formSchema = z
	.object({
		password: z
			.string()
			.min(8, { message: "Password must be at least 8 characters" }),
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
	const token = searchParams.get("token");
	const errorParam = searchParams.get("error");

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { password: "", confirmPassword: "" },
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		if (!token) {
			toast.error("Missing reset token. Request a new reset link.", {
				style: {
					backgroundColor: "var(--destructive)",
					color: "var(--destructive-foreground)",
				},
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
				toast.error(error.message ?? "Failed to reset password", {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
				return;
			}

			toast.success("Password updated", {
				description: "Sign in with your new password.",
			});
			router.push("/login");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to reset password",
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

	const isInvalidToken = !token || errorParam === "INVALID_TOKEN";

	return (
		<div className="flex min-h-screen">
			<div className="relative hidden w-1/2 overflow-hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-between">
				<div
					className="absolute inset-0 opacity-[0.15]"
					style={{
						backgroundImage:
							"radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
						backgroundSize: "24px 24px",
					}}
				/>
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
							Set a new
							<br />
							password.
						</h1>
						<p className="mt-4 max-w-md text-lg text-zinc-400">
							Pick something you&apos;ll remember — but ideally something a
							password manager picks for you.
						</p>
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

			<div className="flex w-full flex-col justify-center px-6 py-10 sm:px-12 lg:w-1/2 lg:px-16 xl:px-24">
				<motion.div
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4, ease: "easeOut" }}
					className="mx-auto w-full max-w-[400px]"
				>
					<div className="mb-6 lg:hidden">
						<div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
							<div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							<span className="text-xs font-medium text-emerald-400">
								DevPass
							</span>
						</div>
					</div>

					{isInvalidToken ? (
						<div className="flex flex-col space-y-4">
							<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
								Reset link invalid or expired
							</h1>
							<p className="text-sm text-muted-foreground">
								This password reset link is no longer valid. Request a new one
								to continue.
							</p>
							<Button asChild className="mt-2 w-full">
								<Link href="/forgot-password">Request a new link</Link>
							</Button>
						</div>
					) : (
						<>
							<div className="flex flex-col space-y-2">
								<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
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
														<Input
															placeholder="••••••••"
															type="password"
															autoComplete="new-password"
															{...field}
														/>
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
															type="password"
															autoComplete="new-password"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<Button
											type="submit"
											className="w-full"
											disabled={isLoading}
										>
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
			</div>
		</div>
	);
}

export default function ResetPassword() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			}
		>
			<ResetPasswordForm />
		</Suspense>
	);
}
