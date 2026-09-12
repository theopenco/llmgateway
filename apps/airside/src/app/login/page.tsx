"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v3";

import { Logo } from "@/components/Logo";
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
import { useAuthErrorToast } from "@/lib/auth-errors";

const formSchema = z.object({
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

function getSafeRedirectUrl(url: string | null): string {
	if (!url) {
		return "/dashboard";
	}
	if (url.startsWith("/") && !url.startsWith("//")) {
		return url;
	}
	return "/dashboard";
}

function LoginForm() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
	const returnUrl = getSafeRedirectUrl(searchParams.get("returnUrl"));

	useUser({ redirectTo: returnUrl, redirectWhen: "authenticated" });
	useAuthErrorToast();

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { email: "", password: "" },
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		try {
			const res = await signIn.email({
				email: values.email,
				password: values.password,
			});
			if (res.error) {
				toast.error(res.error.message ?? "Failed to sign in");
				return;
			}
			queryClient.clear();
			router.push(returnUrl);
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="radar-grid flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-md">
				<Link href="/" className="mb-8 flex items-center justify-center gap-2">
					<Logo />
					<span className="font-display text-lg font-black tracking-tight">
						AIRSIDE
					</span>
				</Link>
				<div className="border-border bg-card rounded-xl border p-8 shadow-2xl">
					<p className="text-primary mb-1 font-mono text-[0.65rem] tracking-[0.3em] uppercase">
						Crew check-in
					</p>
					<h1 className="font-display text-2xl font-black tracking-tight">
						Sign in to operations
					</h1>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="mt-6 space-y-4"
						>
							<FormField
								control={form.control}
								name="email"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Email</FormLabel>
										<FormControl>
											<Input
												type="email"
												autoComplete="email"
												placeholder="ops@yourprovider.ai"
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
												type="password"
												autoComplete="current-password"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<Button
								type="submit"
								className="w-full font-semibold"
								disabled={isLoading}
							>
								{isLoading ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									"Sign in"
								)}
							</Button>
						</form>
					</Form>
					<p className="text-muted-foreground mt-6 text-center text-sm">
						No carrier code yet?{" "}
						<Link href="/signup" className="text-primary hover:underline">
							Claim yours
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense>
			<LoginForm />
		</Suspense>
	);
}
