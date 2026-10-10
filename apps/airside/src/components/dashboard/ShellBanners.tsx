"use client";

import { CarrierProfileBanner } from "@/components/dashboard/CarrierProfileReminder";
import { EmailVerificationBanner } from "@/components/EmailVerificationBanner";

export function ShellBanners() {
	return (
		<div className="flex flex-col gap-3 empty:hidden">
			<EmailVerificationBanner />
			<CarrierProfileBanner />
		</div>
	);
}
