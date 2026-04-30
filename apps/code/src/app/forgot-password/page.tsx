"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	ArrowLeft,
	ArrowRight,
	Code2,
	Cpu,
	Loader2,
	MailCheck,
	Terminal,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
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

const formSchema = z.object({
	email: z.string().email({ message: "Please enter a valid email address" }),
});

export default function ForgotPassword() {
	const authClient = useAuthClient();
	const [isLoading, setIsLoading] = useState(false);
	const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { email: "" },
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		const redirectTo = `${window.location.origin}/reset-password`;

		try {
			const { error } = await authClient.requestPasswordReset({
				email: values.email,
				redirectTo,
			});

			if (error) {
				toast.error(error.message ?? "Failed to send reset email", {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
				return;
			}

			setSubmittedEmail(values.email);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to send reset email",
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

	return (
		<div className="flex min-h-screen">
			{/* Left Brand Panel */}
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
							Forgot it?
							<br />
							We&apos;ve got you.
						</h1>
						<p className="mt-4 max-w-md text-lg text-zinc-400">
							A quick reset and you&apos;re back to shipping. Check your inbox
							for the link.
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

			{/* Right Form Panel */}
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

					{submittedEmail ? (
						<div className="flex flex-col space-y-4">
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
								<MailCheck className="h-6 w-6 text-emerald-500" />
							</div>
							<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
								Check your email
							</h1>
							<p className="text-sm text-muted-foreground">
								If an account exists for{" "}
								<span className="font-medium text-foreground">
									{submittedEmail}
								</span>
								, we&apos;ve sent a password reset link. The link expires in 1
								hour.
							</p>
							<p className="text-xs text-muted-foreground">
								Didn&apos;t get it? Check your spam folder, or{" "}
								<button
									type="button"
									onClick={() => setSubmittedEmail(null)}
									className="underline underline-offset-4 hover:text-foreground"
								>
									try again
								</button>
								.
							</p>
							<Button asChild variant="outline" className="mt-2 w-full">
								<Link href="/login">
									<ArrowLeft className="mr-2 h-4 w-4" />
									Back to sign in
								</Link>
							</Button>
						</div>
					) : (
						<>
							<div className="flex flex-col space-y-2">
								<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
									Forgot your password?
								</h1>
								<p className="text-sm text-muted-foreground">
									Enter your email and we&apos;ll send you a link to reset it.
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
										<Button
											type="submit"
											className="w-full"
											disabled={isLoading}
										>
											{isLoading ? (
												<>
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
													Sending reset link...
												</>
											) : (
												<>
													Send reset link
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
