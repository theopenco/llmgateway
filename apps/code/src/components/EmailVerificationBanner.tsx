"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";

export function EmailVerificationBanner() {
	const { user } = useUser();
	const { sendVerificationEmail } = useAuth();
	const [isResending, setIsResending] = useState(false);

	if (!user || user.emailVerified) {
		return null;
	}

	const handleResendVerification = async () => {
		setIsResending(true);

		const { error } = await sendVerificationEmail({
			email: user.email,
			callbackURL: `${window.location.origin}/dashboard?emailVerified=true`,
		});

		if (error) {
			toast.error("Error", {
				description: error.message ?? "Failed to send verification email",
			});
		} else {
			toast.success("Verification email sent", {
				description: "Please check your inbox for the verification email.",
			});
		}

		setIsResending(false);
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
