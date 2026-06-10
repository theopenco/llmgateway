"use client";

import { Github, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-client";
import { useAppConfig } from "@/lib/config";

interface SocialAuthButtonsProps {
	isLoading: boolean;
	setIsLoading: (loading: boolean) => void;
	callbackPath: string;
	errorCallbackPath: string;
}

export function SocialAuthButtons({
	isLoading,
	setIsLoading,
	callbackPath,
	errorCallbackPath,
}: SocialAuthButtonsProps) {
	const { signIn } = useAuth();
	const { githubAuth, googleAuth } = useAppConfig();

	if (!githubAuth && !googleAuth) {
		return null;
	}

	async function handleSocialSignIn(provider: "github" | "google") {
		setIsLoading(true);
		try {
			const res = await signIn.social({
				provider,
				callbackURL: location.protocol + "//" + location.host + callbackPath,
				errorCallbackURL:
					location.protocol + "//" + location.host + errorCallbackPath,
			});
			if (res?.error) {
				toast.error(res.error.message ?? `Failed to sign in with ${provider}`, {
					style: {
						backgroundColor: "var(--destructive)",
						color: "var(--destructive-foreground)",
					},
				});
			}
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{githubAuth && (
				<Button
					onClick={() => handleSocialSignIn("github")}
					variant="outline"
					className="w-full"
					disabled={isLoading}
				>
					{isLoading ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<Github className="mr-2 h-4 w-4" />
					)}
					GitHub
				</Button>
			)}
			{googleAuth && (
				<Button
					onClick={() => handleSocialSignIn("google")}
					variant="outline"
					className="w-full"
					disabled={isLoading}
				>
					{isLoading ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
							<path
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
								fill="#4285F4"
							/>
							<path
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
								fill="#34A853"
							/>
							<path
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
								fill="#FBBC05"
							/>
							<path
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
								fill="#EA4335"
							/>
						</svg>
					)}
					Google
				</Button>
			)}
		</div>
	);
}
