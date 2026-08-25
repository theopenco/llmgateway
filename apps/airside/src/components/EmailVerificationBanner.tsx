"use client";

import { MailWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { useAuth } from "@/lib/auth-client";

export function EmailVerificationBanner() {
	const { user } = useUser();
	const { sendVerificationEmail } = useAuth();
	const [isSending, setIsSending] = useState(false);

	if (!user || user.emailVerified) {
		return null;
	}

	async function resend() {
		if (!user) {
			return;
		}
		setIsSending(true);
		const res = await sendVerificationEmail({
			email: user.email,
			callbackURL: `${window.location.origin}/onboarding?emailVerified=true`,
		});
		setIsSending(false);
		if (res.error) {
			toast.error(res.error.message ?? "Failed to send verification email");
		} else {
			toast.success("Verification email sent — check your inbox.");
		}
	}

	return (
		<div className="border-primary/40 bg-primary/10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
			<div className="flex items-center gap-3">
				<MailWarning className="text-primary size-4 shrink-0" />
				<p className="text-sm">
					Verify <span className="font-mono">{user.email}</span> to claim a
					carrier — your email domain is your credential.
				</p>
			</div>
			<Button size="sm" variant="outline" onClick={resend} disabled={isSending}>
				{isSending ? "Sending…" : "Resend email"}
			</Button>
		</div>
	);
}
