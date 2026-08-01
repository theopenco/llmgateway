"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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

const formSchema = z.object({
	email: z.string().email({
		message: "Please enter a valid email address",
	}),
});

export default function ForgotPassword() {
	const [isLoading, setIsLoading] = useState(false);
	const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
	const authClient = useAuthClient();

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
				toast({
					title: error.message ?? "Failed to send reset email",
					variant: "destructive",
				});
				return;
			}

			setSubmittedEmail(values.email);
		} catch (err) {
			toast({
				title:
					err instanceof Error ? err.message : "Failed to send reset email",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	}

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

			{submittedEmail ? (
				<div className="flex flex-col space-y-4">
					<div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
						<MailCheck className="h-6 w-6 text-emerald-500" />
					</div>
					<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
						Check your email
					</h1>
					<p className="text-sm text-muted-foreground">
						If an account exists for{" "}
						<span className="font-medium text-foreground">
							{submittedEmail}
						</span>
						, we&apos;ve sent a password reset link. The link expires in 1 hour.
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
						<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
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
								<Button type="submit" className="w-full" disabled={isLoading}>
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
	);
}
