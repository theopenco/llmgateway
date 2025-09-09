"use client";

import { useState } from "react";

import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";

export function EmailVerificationBanner() {
	const { user } = useUser();
	const config = useAppConfig();
	const [isResending, setIsResending] = useState(false);

	if (!user || user.emailVerified) {
		return null;
	}

	const handleResendVerification = async () => {
		setIsResending(true);

		try {
			const response = await fetch(
				`${config.apiUrl}/auth/send-verification-email`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						email: user.email,
						callbackURL: `${window.location.origin}/dashboard?emailVerified=true`,
					}),
				},
			);

			if (!response.ok) {
				throw new Error("Failed to send verification email");
			}

			toast({
				title: "Verification email sent",
				description: "Please check your inbox for the verification email.",
			});
		} catch (error) {
			toast({
				title: "Error",
				description:
					error instanceof Error
						? error.message
						: "Failed to send verification email",
				variant: "destructive",
			});
		} finally {
			setIsResending(false);
		}
	};

	return (
		<div className="bg-yellow-50 border border-yellow-200 px-4 py-3 dark:bg-yellow-900/20 dark:border-yellow-800">
			<div className="flex items-center justify-between">
				<div className="flex items-center">
					<div className="flex-1">
						<p className="text-sm text-yellow-800 dark:text-yellow-200">
							<strong>Your email is unverified.</strong> Please check your inbox
							and click the verification link to access all features.
						</p>
					</div>
				</div>
				<div className="ml-4">
					<Button
						variant="outline"
						size="sm"
						onClick={handleResendVerification}
						disabled={isResending}
						className="border-yellow-300 text-yellow-800 hover:bg-yellow-100 dark:border-yellow-700 dark:text-yellow-200 dark:hover:bg-yellow-800/30"
					>
						{isResending ? "Sending..." : "Resend Email"}
					</Button>
				</div>
			</div>
		</div>
	);
}
