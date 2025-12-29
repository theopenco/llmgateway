"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Github } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import { useAppConfig } from "@/lib/config";

export default function Signup() {
	const t = useTranslations("auth");
	const queryClient = useQueryClient();
	const router = useRouter();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const { signUp, signIn } = useAuth();
	const config = useAppConfig();

	const createFormSchema = (isHosted: boolean) =>
		z.object({
			name: z.string().min(2, {
				message: t("nameRequired"),
			}),
			email: isHosted
				? z
						.string()
						.email({
							message: t("validEmailRequired"),
						})
						.refine((email) => !email.split("@")[0]?.includes("+"), {
							message: t("emailWithPlusNotAllowed"),
						})
				: z.string().email({
						message: t("validEmailRequired"),
					}),
			password: z.string().min(8, {
				message: t("passwordMinLength"),
			}),
		});

	const formSchema = createFormSchema(config.hosted);

	// Redirect to dashboard if already authenticated
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
					queryClient.clear();
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_signed_up", {
						email: values.email,
						name: values.name,
					});
					toast({
						title: t("accountCreated"),
						description: t("checkEmailToVerify"),
					});
					router.push("/onboarding");
				},
				onError: (ctx) => {
					toast({
						title: ctx.error.message || t("failedToSignUp"),
						variant: "destructive",
					});
				},
			},
		);

		if (error) {
			toast({
				title: error.message || t("failedToSignUp"),
				variant: "destructive",
			});
		}

		setIsLoading(false);
	}

	return (
		<div className="px-4 sm:px-0 max-w-[64rem] mx-auto flex h-screen w-screen flex-col items-center justify-center">
			<div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
				<div className="flex flex-col space-y-2 text-center">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("createAccount")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("enterEmailToCreateAccount")}
					</p>
				</div>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("name")}</FormLabel>
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
									<FormLabel>{t("email")}</FormLabel>
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
									<FormLabel>{t("password")}</FormLabel>
									<FormControl>
										<Input placeholder="••••••••" type="password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("creatingAccount")}
								</>
							) : (
								t("createAccount")
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
							{t("or")}
						</span>
					</div>
				</div>
				<Button
					onClick={async () => {
						setIsLoading(true);
						try {
							const res = await signIn.social({
								provider: "github",
								callbackURL:
									location.protocol + "//" + location.host + "/dashboard",
							});
							if (res?.error) {
								toast({
									title: res.error.message || t("failedToSignUpWithGithub"),
									variant: "destructive",
								});
							}
						} finally {
							setIsLoading(false);
						}
					}}
					variant="outline"
					className="w-full"
					disabled={isLoading}
				>
					{isLoading ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<Github className="mr-2 h-4 w-4" />
					)}
					{t("signUpWithGithub")}
				</Button>
				<p className="px-8 text-center text-sm text-muted-foreground">
					<Link
						href="/login"
						className="hover:text-brand underline underline-offset-4"
					>
						{t("alreadyHaveAccount")}
					</Link>
				</p>
			</div>
		</div>
	);
}
