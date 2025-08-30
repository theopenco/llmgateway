import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, KeySquare } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAuth } from "@/lib/auth-client";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
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
import { useApi } from "@/lib/fetch-client";

const loginSchema = z.object({
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

const signupSchema = z.object({
	name: z.string().min(2, { message: "Name is required" }),
	email: z.string().email({ message: "Please enter a valid email address" }),
	password: z
		.string()
		.min(8, { message: "Password must be at least 8 characters" }),
});

interface AuthDialogProps {
	open: boolean;
}

export function AuthDialog({ open }: AuthDialogProps) {
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const [isLoading, setIsLoading] = useState(false);
	const [mode, setMode] = useState<"login" | "signup">("login");
	const { signIn, signUp } = useAuth();
	const api = useApi();

	const loginForm = useForm<z.infer<typeof loginSchema>>({
		resolver: zodResolver(loginSchema),
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const signupForm = useForm<z.infer<typeof signupSchema>>({
		resolver: zodResolver(signupSchema),
		defaultValues: {
			name: "",
			email: "",
			password: "",
		},
	});

	const handleLogin = async (values: z.infer<typeof loginSchema>) => {
		setIsLoading(true);

		const { error } = await signIn.email(
			{
				email: values.email,
				password: values.password,
			},
			{
				onSuccess: (ctx) => {
					const queryKey = api.queryOptions("get", "/user/me").queryKey;
					queryClient.invalidateQueries({ queryKey });
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_logged_in", {
						method: "email",
						email: values.email,
					});
					toast({ title: "Login successful" });
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
	};

	const handleSignup = async (values: z.infer<typeof signupSchema>) => {
		setIsLoading(true);

		const { error } = await signUp.email(
			{
				name: values.name,
				email: values.email,
				password: values.password,
				callbackURL: "/playground",
			},
			{
				onSuccess: (ctx) => {
					const queryKey = api.queryOptions("get", "/user/me").queryKey;
					queryClient.invalidateQueries({ queryKey });
					posthog.identify(ctx.data.user.id, {
						email: ctx.data.user.email,
						name: ctx.data.user.name,
					});
					posthog.capture("user_signed_up", {
						email: values.email,
						name: values.name,
					});
					toast({ title: "Account created", description: "Welcome!" });
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
	};

	const handlePasskeySignIn = async () => {
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
			const queryKey = api.queryOptions("get", "/user/me").queryKey;
			queryClient.invalidateQueries({ queryKey });
			posthog.capture("user_logged_in", { method: "passkey" });
			toast({ title: "Login successful" });
		} catch (error: unknown) {
			toast({
				title:
					error instanceof Error
						? error.message
						: "Failed to sign in with passkey",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Dialog open={open} modal={true}>
			<DialogContent
				className="sm:max-w-[420px] [&>button]:hidden"
				onPointerDownOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>
						{mode === "login"
							? "Sign in to LLM Gateway"
							: "Create your account"}
					</DialogTitle>
					<DialogDescription>
						{mode === "login"
							? "Enter your credentials to access the playground"
							: "Create an account to start using the playground"}
					</DialogDescription>
				</DialogHeader>

				{mode === "login" ? (
					<Form {...loginForm}>
						<form
							onSubmit={loginForm.handleSubmit(handleLogin)}
							className="space-y-4"
						>
							<FormField
								control={loginForm.control}
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
								control={loginForm.control}
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
				) : (
					<Form {...signupForm}>
						<form
							onSubmit={signupForm.handleSubmit(handleSignup)}
							className="space-y-4"
						>
							<FormField
								control={signupForm.control}
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
								control={signupForm.control}
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
								control={signupForm.control}
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
				)}

				{mode === "login" && (
					<>
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
					</>
				)}

				<div className="text-center text-sm">
					{mode === "login" ? (
						<span>
							Don't have an account?{" "}
							<button
								type="button"
								onClick={() => setMode("signup")}
								className="text-primary hover:underline"
							>
								Create one
							</button>
						</span>
					) : (
						<span>
							Already have an account?{" "}
							<button
								type="button"
								onClick={() => setMode("login")}
								className="text-primary hover:underline"
							>
								Sign in
							</button>
						</span>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
