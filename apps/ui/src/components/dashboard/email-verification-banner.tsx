import { Mail, X } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/lib/components/alert";
import { Button } from "@/lib/components/button";
import { toast } from "@/lib/components/use-toast";

interface EmailVerificationBannerProps {
	userEmail: string;
}

export function EmailVerificationBanner({
	userEmail,
}: EmailVerificationBannerProps) {
	const [isHidden, setIsHidden] = useState(false);
	const [isResending, setIsResending] = useState(false);
	const { sendVerificationEmail } = useAuth();

	const handleResendEmail = async () => {
		setIsResending(true);
		try {
			const result = await sendVerificationEmail({ email: userEmail });
			if (result.error) {
				toast({
					title: "Failed to send verification email",
					description: result.error.message,
					variant: "destructive",
				});
			} else {
				toast({
					title: "Verification email sent",
					description: "Check your inbox for the verification link.",
				});
			}
		} catch (_error) {
			toast({
				title: "Failed to send verification email",
				description: "Please try again later.",
				variant: "destructive",
			});
		} finally {
			setIsResending(false);
		}
	};

	if (isHidden) {
		return null;
	}

	return (
		<Alert className="mx-4 md:mx-6 lg:mx-8 mt-4 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950 flex items-center gap-4">
			<div>
				<Mail className="size-4 text-orange-600 dark:text-orange-400" />
			</div>
			<AlertDescription className="flex items-center justify-between">
				<div className="flex flex-col sm:flex-row sm:items-center gap-2">
					<span className="text-orange-800 dark:text-orange-200">
						Please verify your email address ({userEmail}) to ensure you receive
						important updates.
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={handleResendEmail}
						disabled={isResending}
						className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-900"
					>
						{isResending ? "Sending..." : "Resend email"}
					</Button>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setIsHidden(true)}
					className="text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-200"
				>
					<X className="h-4 w-4" />
				</Button>
			</AlertDescription>
		</Alert>
	);
}
