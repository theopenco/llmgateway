"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/auth-errors";
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

import type { Route } from "next";

const formSchema = z.object({
	email: z.string().email({
		message: "Please enter a valid email address",
	}),
});

export default function Sso() {
	const router = useRouter();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
	const { ssoEnabled } = useAppConfig();

	// Support a post-login `?redirect=` target (e.g. the CLI connect flow). Only
	// same-origin relative paths are honored to avoid open-redirects.
	const [redirectTarget] = useState(() => {
		if (typeof window === "undefined") {
			return "/dashboard";
		}
		const target = new URLSearchParams(window.location.search).get("redirect");
		return target && target.startsWith("/") && !target.startsWith("//")
			? target
			: "/dashboard";
	});

	// Prefill the email the user may have already typed on the login page.
	const [defaultEmail] = useState(() => {
		if (typeof window === "undefined") {
			return "";
		}
		return new URLSearchParams(window.location.search).get("email") ?? "";
	});

	useUser({
		redirectTo: redirectTarget,
		redirectWhen: "authenticated",
		checkOnboarding: true,
	});

	useEffect(() => {
		if (!ssoEnabled) {
			router.replace("/login");
		}
	}, [ssoEnabled, router]);

	useEffect(() => {
		posthog.capture("page_viewed_sso");
	}, [posthog]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const error = params.get("error");
		if (error) {
			toast({
				title: getAuthErrorMessage(error),
				variant: "destructive",
			});
			params.delete("error");
			const query = params.toString();
			router.replace(window.location.pathname + (query ? `?${query}` : ""));
		}
	}, [router]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			email: defaultEmail,
		},
	});

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		try {
			const res = await signIn.sso({
				email: values.email,
				callbackURL: location.protocol + "//" + location.host + redirectTarget,
				errorCallbackURL: location.protocol + "//" + location.host + "/sso",
			});
			if (res?.error) {
				toast({
					title:
						res.error.message ??
						"No SSO connection found for this email domain",
					variant: "destructive",
				});
			}
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
			{/* Mobile brand header */}
			<div className="mb-6 lg:hidden">
				<p className="text-sm font-medium uppercase tracking-widest text-primary">
					LLM Gateway
				</p>
			</div>

			<div className="flex flex-col space-y-2">
				<h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
					Sign in with SSO
				</h1>
				<p className="text-sm text-muted-foreground">
					Enter your work email and we&apos;ll redirect you to your
					organization&apos;s identity provider.
				</p>
			</div>

			<div className="mt-8 space-y-4">
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
											autoComplete="username"
											autoFocus
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
									Redirecting...
								</>
							) : (
								<>
									<Building2 className="mr-2 h-4 w-4" />
									Continue with SSO
									<ArrowRight className="ml-2 h-4 w-4" />
								</>
							)}
						</Button>
					</form>
				</Form>

				<Button asChild variant="ghost" className="w-full">
					<Link href={"/login" as Route}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to login
					</Link>
				</Button>
			</div>
		</motion.div>
	);
}
